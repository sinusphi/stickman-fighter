"""Bake fixed-length two-bone leg IK for planted steps. Standing walks go both
ways; the crouch only walks forward (down-back is a stationary guard)."""
import json, math, sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
p=json.loads((root/'src/data/poses.json').read_text())
rules=json.loads((root/'src/data/rules.json').read_text())
ref=json.loads((root/'src/data/figure-scale.json').read_text())
scale=((ref['referenceHeight']+ref['referenceHeadRadius'])/ref['referenceHeight'])**ref['headRadiusIncrements']
# Down-back no longer walks: drop the former backward crouch cycle.
for name in [n for n in p['poses'] if n.startswith('CrouchWalkBackward_')]:del p['poses'][name]
p['animations'].pop('CrouchWalkBackward',None)
for crouching in [False,True]:
 for backward in [False,True]:
  if crouching and backward:continue
  id=('CrouchWalk' if crouching else 'Walk')+('Backward' if backward else '')
  duration=40 if crouching else 30;period=duration-1
  forward_walk=not crouching and not backward
  speed=rules['crouchForwardSpeed'] if crouching else rules['backwardSpeed' if backward else 'forwardSpeed']
  velocity=speed/rules['unit']/scale*(-1 if backward else 1)
  stance=.62 if forward_walk else .5
  stride=abs(velocity)*period*stance;keys=[]
  for frame in range(period+1):
   phase=frame/period;pose=json.loads(json.dumps(p['poses']['crouch' if crouching else 'guard']))
   height=(30 if crouching else 45)-.8*math.sin(2*math.pi*phase)**2
   if forward_walk:height=44.5-.6*math.sin(2*math.pi*phase)**2
   pose['root']=[0,-height]
   angles=pose['angles']
   if crouching:angles['neck']=-78;angles['head']=-90-angles['neck']
   else:
    # Reference 12: hunched torso and forward-hanging head as in the stance.
    angles['neck']=-76 if backward else -73;angles['head']=(-55 if backward else -52)-angles['neck']
   for side,offset in [('left',0),('right',.5)]:
    t=(phase+offset)%1
    if t<stance:footx=stride/2-(abs(velocity)*period*t if forward_walk else stride*t*2);footy=0
    else:
     u=(t-stance)/(1-stance)
     if forward_walk:
      # Match the planted foot's velocity at lift-off and touchdown. The foot
      # continues behind the hip briefly before the knee folds into the swing.
      footx=-stride/2+stride*(3*u*u-2*u*u*u)-abs(velocity)*period*(1-stance)*(u-3*u*u+2*u*u*u)
      footy=-8*math.sin(math.pi*u)**2
     else:footx=-stride/2+stride*u;footy=-(4 if crouching else 6)*math.sin(math.pi*u)**2
    if backward:footx=-footx
    dx=footx;dy=height+footy;length=math.hypot(dx,dy)
    bend=math.acos(min(1,length/50));theta=math.atan2(dy,dx)
    angles[side+'Knee']=math.degrees(theta-bend);angles[side+'Foot']=math.degrees(2*bend)
    if crouching:
     angles[side+'Shoulder']= (55 if side=='left' else 125)-angles['neck']
     angles[side+'Elbow']+=3*math.sin(2*math.pi*(phase+offset))
    else:
     # Guard stays up while walking (hunched Reference 12 body): both fists
     # keep the stance angles and only bob slightly with the step.
     guard=p['poses']['guard']['angles'];bob=2*math.sin(2*math.pi*(phase+offset))
     angles[side+'Shoulder']=guard[side+'Shoulder']+guard['neck']-angles['neck']
     angles[side+'Elbow']=guard[side+'Elbow']+bob;angles[side+'Hand']=guard[side+'Hand']-bob
   name=id+'_step_'+str(frame);p['poses'][name]=pose
   keys.append({'frame':frame,'pose':name,'easing':'linear'})
  keys[-1]['pose']=keys[0]['pose']
  p['animations'][id]={'durationFrames':duration,'loop':True,'grounded':True,'interpolation':'angles','keyframes':keys}
result=json.dumps(p,indent=2)+'\n'
if '--check' in sys.argv:
 assert (root/'src/data/poses.json').read_text()==result, 'Laufposen veraltet: python scripts/generate-walk-poses.py'
else:
 (root/'src/data/poses.json').write_text(result)
print('Laufposen und feste Knochenlängen synchron.')
