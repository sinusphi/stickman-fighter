"""Bake the forward run cycle (state `Run`) with fixed-length two-bone leg IK.
Same planted-foot model as the forward walk (scripts/generate-walk-poses.py):
the stance foot moves backwards at exactly rules.runSpeed, so it stays fixed in
world space. Compared with the walk: torso leans further forward, steps are
longer and lifted higher, and the arms swing against the legs."""
import json, math, sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
p=json.loads((root/'src/data/poses.json').read_text())
rules=json.loads((root/'src/data/rules.json').read_text())
ref=json.loads((root/'src/data/figure-scale.json').read_text())
scale=((ref['referenceHeight']+ref['referenceHeadRadius'])/ref['referenceHeight'])**ref['headRadiusIncrements']
for name in [n for n in p['poses'] if n.startswith('Run_step_')]:del p['poses'][name]
ID='Run'
# 20 frames per double step: three steps per second at 60 Hz.
duration=20;period=duration-1
velocity=rules['runSpeed']/rules['unit']/scale
stance=.5
stride=velocity*period*stance
# Lower hips than the walk (44.5): bent knees carry the longer stride.
base_height=41.5
# Spine and head: leaning into the run (walk: neck -73, head -52 absolute).
NECK=-60;HEAD=-48
SWING=32
guard=p['poses']['guard']['angles']
keys=[]
for frame in range(period+1):
 phase=frame/period;pose=json.loads(json.dumps(p['poses']['guard']))
 # Lowest at each touchdown, highest at mid stance (push-off).
 height=base_height+.9*math.sin(2*math.pi*phase)**2
 pose['root']=[0,-height]
 angles=pose['angles']
 angles['neck']=NECK;angles['head']=HEAD-NECK
 for side,offset in [('left',0),('right',.5)]:
  t=(phase+offset)%1
  if t<stance:footx=stride/2-velocity*period*t;footy=0
  else:
   u=(t-stance)/(1-stance)
   # Velocity-matched lift-off and touchdown (as the forward walk); the heel
   # kicks up behind the hip before the knee drives forward.
   footx=-stride/2+stride*(3*u*u-2*u*u*u)-velocity*period*(1-stance)*(u-3*u*u+2*u*u*u)
   footy=-24*math.sin(math.pi*u**.75)**2
  dx=footx;dy=height+footy;length=math.hypot(dx,dy)
  bend=math.acos(min(1,length/50));theta=math.atan2(dy,dx)
  angles[side+'Knee']=math.degrees(theta-bend);angles[side+'Foot']=math.degrees(2*bend)
  # Arms swing against the legs: the left arm drives forward with the right leg.
  swing=SWING*math.cos(2*math.pi*(phase+offset))
  angles[side+'Shoulder']=guard[side+'Shoulder']+guard['neck']-NECK+swing
  angles[side+'Elbow']=guard[side+'Elbow']-swing*.4;angles[side+'Hand']=guard[side+'Hand']+swing*.4
 name=ID+'_step_'+str(frame);p['poses'][name]=pose
 keys.append({'frame':frame,'pose':name,'easing':'linear'})
keys[-1]['pose']=keys[0]['pose']
del p['poses'][ID+'_step_'+str(period)]
p['animations'][ID]={'durationFrames':duration,'loop':True,'grounded':True,'interpolation':'angles','keyframes':keys}
result=json.dumps(p,indent=2)+'\n'
if '--check' in sys.argv:
 assert (root/'src/data/poses.json').read_text()==result, 'Rennposen veraltet: npm run generate:run'
else:
 (root/'src/data/poses.json').write_text(result)
print('Rennposen synchron.')
