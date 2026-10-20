import json,sys,glob,collections,re
files=[f for base in sys.argv[1:] for d in glob.glob(base) for f in glob.glob(d+'/*.jsonl')]
NUDGE={'handoff':'vfkb handoff check','stale':'vfkb stale-handoff check','decision':'vfkb decision-capture check'}
S=collections.Counter(); per_session=[]
def is_handoff_write(b):
  n=b.get('name',''); i=b.get('input',{})
  if n.endswith('kb_add'):
    tags=i.get('tags') or []
    if isinstance(tags,str): tags=tags.split(',')
    return any(t.strip() in ('handoff','next') for t in tags)
  if n=='Skill' and 'handoff' in str(i.get('skill','')): return True
  if n=='Bash':
    c=i.get('command','')
    return bool(re.search(r'\badd fact\b',c) and re.search(r'--tags[ =][^ ]*handoff',c))
  return False
for f in files:
  try: lines=[json.loads(l) for l in open(f)]
  except Exception: continue
  ev=[]
  for e in lines:
    t=e.get('type')
    if e.get('isSidechain'): continue
    if t=='user' and e.get('promptSource') is not None:
      ev.append(('prompt',None))
    elif t=='attachment' and e.get('attachment',{}).get('type')=='hook_additional_context':
      s=json.dumps(e['attachment'])
      for k,v in NUDGE.items():
        if v in s: ev.append(('nudge',k))
    elif t=='assistant':
      for b in e['message'].get('content',[]):
        if b.get('type')=='tool_use' and is_handoff_write(b): ev.append(('write',None))
  prompts=sum(1 for k,_ in ev if k=='prompt')
  if prompts==0: continue
  S['sessions']+=1
  fires=collections.Counter(v for k,v in ev if k=='nudge')
  writes=sum(1 for k,_ in ev if k=='write')
  if fires or writes: per_session.append((f.split('/')[-1][:8],prompts,dict(fires),writes))
  for i,(k,v) in enumerate(ev):
    if k!='nudge': continue
    S[f'{v}:fires']+=1
    acted=False
    for k2,_ in ev[i+1:]:
      if k2=='prompt': break
      if k2=='write': acted=True; break
    rem=sum(1 for k2,_ in ev[i+1:] if k2=='prompt')
    S[f'{v}:{"acted" if acted else "declined"}']+=1
    S[f'{v}:{"on_final_turn" if rem==0 else "mid_session"}']+=1
  for i,(k,v) in enumerate(ev):
    if k=='write':
      rem=sum(1 for k2,_ in ev[i+1:] if k2=='prompt')
      S['writes']+=1; S['writes_on_final_turn' if rem==0 else 'writes_mid_session']+=1
for k in sorted(S): print(f'{k}: {S[k]}')
print('\nsession  prompts  fires  handoff_writes')
for r in sorted(per_session,key=lambda r:-r[1]): print(*r)
