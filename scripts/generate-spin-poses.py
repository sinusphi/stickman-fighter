"""Replace 4+MK / 6+HK with opposite-leg, reverse-turn versions of 4+HK.

The baked forward_spin_hk is the reference. Keep existing move timing and
commands, swap the leg roles, reverse yaw, and lower only MK's striking arc.
Run generate:tornado first after editing the reference animation.
"""
import copy
import json
import math
import sys
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'src/data/poses.json'
data = json.loads(path.read_text())
moves = json.loads(path.with_name('moves.json').read_text())
reference = data['animations']['forward_spin_hk']
guard = data['poses']['guard']

def smooth(value):
    t = max(0, min(1, value))
    return t*t*(3-2*t)

def angle(a, b, t):
    return a + ((b-a+180) % 360-180)*t

for name in list(data['poses']):
    if name.startswith(('spin_lk_', 'spin_mk_', 'spin_hk_')):
        del data['poses'][name]
data['animations'].pop('spin_lk', None)
for move in (m for m in moves if m['id'] in ('spin_mk', 'spin_hk')):
    duration = move['startup']+move['active']+move['recovery']
    start, end = move['startup'], move['startup']+move['active']-1
    keys = []
    for frame in range(duration):
        # Preserve the reference's contact phase at frames 24..29.
        source = (frame/start*24 if frame <= start else
                  24+(frame-start)/(end-start)*5 if frame <= end else
                  29+(frame-end)/(duration-1-end)*17)
        lo, hi = math.floor(source), math.ceil(source)
        a, b = (data['poses'][reference['keyframes'][i]['pose']] for i in (lo, hi))
        t = source-lo
        pose = {'root': [x+(y-x)*t for x,y in zip(a['root'],b['root'])],
                'angles': {j: angle(v,b['angles'][j],t) for j,v in a['angles'].items()}}
        original = dict(pose['angles'])
        # Release the normal guard smoothly into the exchanged leg roles.
        envelope = smooth(min(source/6, (46-source)/10))
        for side, other in [('left','right'),('right','left')]:
            for joint in ('Knee','Foot'):
                pose['angles'][side+joint] = angle(original[side+joint],original[other+joint],envelope)
        if move['id'] == 'spin_mk':
            pose['angles']['rightKnee'] += 40*smooth((source-12)/12)*smooth((46-source)/10)
        yaw = -(reference['keyframes'][lo]['yaw']+(reference['keyframes'][hi]['yaw']-reference['keyframes'][lo]['yaw'])*t)
        if frame in (0,duration-1):
            pose = copy.deepcopy(guard)
        name = f"{move['id']}_{frame}"
        data['poses'][name] = pose
        keys.append({'frame':frame,'pose':name,'easing':'linear','yaw':yaw,
                     'turn':(1-math.cos(math.radians(yaw)))/2})
    # Promote the extended striking leg at contact, then restore guard layers.
    keys[start]['depths'] = {'rightKnee':12,'rightFoot':13}
    keys[duration-2]['depths'] = {j:data['segmentDepths'][j] for j in ('rightKnee','rightFoot')}
    data['animations'][move['id']] = {
        'durationFrames':duration,'loop':False,'grounded':False,'clampFloor':True,
        'interpolation':'angles','fixedLegDepth':True,'keyframes':keys,
        'trail':{'joint':'rightFoot','fromFrame':round(start/4),'toFrame':end,
                 'historyFrames':5,'directional':True}}
result=json.dumps(data,indent=2)+'\n'
if '--check' in sys.argv:
    assert json.loads(path.read_text())==data, 'Spin poses stale: npm run generate:spin-poses'
else:
    path.write_text(result)
print('Reverse-turn right-leg middle/high spins synchronized from 4+HK.')
