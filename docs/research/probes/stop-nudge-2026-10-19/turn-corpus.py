import json,sys,glob,collections,re
out=sys.argv[1]; bases=sys.argv[2:]
files=sorted({f for b in bases for d in glob.glob(b) for f in glob.glob(d+'/*.jsonl')})
src=collections.Counter(); origin=collections.Counter()
ARM_TOOLS={'Monitor','CronCreate','ScheduleWakeup','Workflow','RemoteTrigger'}
def kb_kind(b):
  n=b.get('name',''); i=b.get('input',{}) or {}
  if n.endswith('kb_add'):
    tags=i.get('tags') or []
    if isinstance(tags,str): tags=tags.split(',')
    return i.get('type'), [t.strip() for t in tags], (i.get('text') or i.get('content') or '')[:160]
  if n=='Bash':
    c=i.get('command','')
    m=re.search(r'\badd (decision|fact|gotcha|pattern|link)\b',c)
    if m and ('vfkb' in c or 'cli.js' in c):
      tm=re.search(r'--tags?[ =]"?([\w,\-:]+)',c)
      tx=re.search(r'add \w+ "([^"]{0,160})',c)
      return m.group(1),(tm.group(1).split(',') if tm else []),(tx.group(1) if tx else '')
    if 'gh issue create' in c:
      tx=re.search(r'--title[ =]"([^"]{0,120})',c); return 'issue',[],(tx.group(1) if tx else '')
  return None,None,None
W=open(out,'w'); n=0
for f in files:
  try: lines=[json.loads(l) for l in open(f)]
  except Exception: continue
  sid=f.split('/')[-1][:8]; turns=[]; cur=None
  for e in lines:
    if e.get('isSidechain'): continue
    t=e.get('type')
    if t=='user' and not e.get('isMeta') and not e.get('toolUseResult'):
      c=e['message']['content']
      if isinstance(c,list) and any(isinstance(x,dict) and x.get('type')=='tool_result' for x in c): continue
      txt=c if isinstance(c,str) else ' '.join(x.get('text','') for x in c if isinstance(x,dict) and x.get('type')=='text')
      st=txt.lstrip()
      if not st or st.startswith(('Stop hook feedback','[Request interrupted','<local-command','<command-','Caveat:','<task-notification','<system-reminder','This session is being continued','[Your previous response')): continue
      src[e.get('promptSource')]+=1; origin[e.get('turnOrigin')]+=1
      cur={'s':sid,'i':len(turns),'src':e.get('promptSource'),'origin':e.get('turnOrigin'),'ts':e.get('timestamp'),'prompt':txt,'final':'','writes':[],'arms':[],'tools':0}
      turns.append(cur)
    elif t=='assistant' and cur:
      for b in e['message'].get('content',[]):
        if b.get('type')=='text' and b.get('text','').strip(): cur['final']=b['text']
        elif b.get('type')=='tool_use':
          cur['tools']+=1
          k,tags,tx=kb_kind(b)
          if k: cur['writes'].append({'type':k,'tags':tags,'text':tx})
          n_=b.get('name',''); i=b.get('input',{}) or {}
          if n_ in ARM_TOOLS or (n_=='Bash' and i.get('run_in_background')) or (n_ in('Agent','Task') and i.get('run_in_background')):
            cur['arms'].append(n_)
  for i,t in enumerate(turns):
    t['n_turns']=len(turns); t['last']= i==len(turns)-1
    W.write(json.dumps(t)+'\n'); n+=1
print('turns',n,'sessions',len(files)); print('promptSource',src.most_common()); print('turnOrigin',origin.most_common())
