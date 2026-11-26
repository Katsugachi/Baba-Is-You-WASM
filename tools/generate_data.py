import os,re,json,struct,zlib
repo=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
base=os.path.join(repo,'Base Files','Data')
outdir=os.path.join(repo,'web')
# object metadata from values.lua
s=open(os.path.join(base,'values.lua'),encoding='utf-8',errors='replace').read()
tiles={}
nameToClass={}
for m in re.finditer(r'\t(object\d+) =\s*\{(.*?)\n\t\}',s,re.S):
    obj,g=m.groups()
    def txt(k):
        mm=re.search(r'\b'+k+r' = "([^"]*)"',g); return mm.group(1) if mm else None
    def num(k):
        mm=re.search(r'\b'+k+r' = (-?\d+)',g); return int(mm.group(1)) if mm else None
    def arr(k):
        mm=re.search(r'\b'+k+r' = \{\s*(-?\d+),\s*(-?\d+)\s*\}',g); return [int(mm.group(1)),int(mm.group(2))] if mm else None
    tile=arr('tile')
    if not tile: continue
    name=txt('name') or obj
    meta={'name':name,'sprite':txt('sprite') or name,'root':bool(re.search(r'\bsprite_in_root = true',g)),'unittype':txt('unittype') or 'object','type':num('type') or 0,'tiling':num('tiling') if num('tiling') is not None else -1,'layer':num('layer') or 10,'colour':arr('colour') or [0,3],'active':arr('active'),'tile':tile}
    tiles[obj]=meta
    nameToClass[name]=obj
# edge
tiles['edge']={'name':'edge','sprite':'edge','root':True,'unittype':'object','type':0,'tiling':1,'layer':1,'colour':[0,2],'active':None,'tile':[0,0]}
nameToClass['edge']='edge'

def parse_level(path):
    b=open(path,'rb').read()
    if not b.startswith(b'ACHTUNG!'): raise ValueError('bad header')
    # width/height are consistent across layers; first LAYR header begins after MAP block.
    li=b.index(b'LAYR')
    width=struct.unpack_from('<I',b,li+10)[0]
    height=struct.unpack_from('<I',b,li+14)[0]
    mains=[]; datas=[]
    pos=0
    while True:
        mi=b.find(b'MAIN',pos)
        if mi<0: break
        zpos=b.find(b"\x78\x01",mi)
        d=zlib.decompressobj(); data=d.decompress(b[zpos:])+d.flush()
        mains.append(data)
        pos=zpos+(len(b[zpos:])-len(d.unused_data))
    pos=0
    while True:
        di=b.find(b'DATA',pos)
        if di<0: break
        zpos=b.find(b"\x78\x01",di)
        d=zlib.decompressobj(); data=d.decompress(b[zpos:])+d.flush()
        datas.append(data)
        pos=zpos+(len(b[zpos:])-len(d.unused_data))
    layers=[]
    for n,main in enumerate(mains):
        if len(main)!=width*height*2:
            raise ValueError(f'main len {len(main)} != {width*height*2}')
        dirs=datas[n] if n<len(datas) and len(datas[n])==width*height else bytes([3])*(width*height)
        objs=[]
        vals=struct.unpack('<%dH'%(width*height),main)
        for i,v in enumerate(vals):
            if v==0xffff: continue
            x=i%width; y=i//width
            objs.append({'x':x,'y':y,'tx':v&255,'ty':v>>8,'d':dirs[i]})
        layers.append(objs)
    return {'w':width,'h':height,'layers':layers}
levels={}
texts={}
wroot=os.path.join(base,'Worlds')
for world in sorted(os.listdir(wroot)):
    wdir=os.path.join(wroot,world)
    if not os.path.isdir(wdir): continue
    levels[world]={}
    for fn in sorted(os.listdir(wdir)):
        p=os.path.join(wdir,fn)
        rel=f'Data/Worlds/{world}/{fn}'
        if fn.endswith('.l'):
            try: levels[world][fn[:-2]]=parse_level(p)
            except Exception as e: print('level parse error',rel,e)
        elif fn.endswith('.ld') or fn=='world_data.txt':
            texts[rel]=open(p,encoding='utf-8',errors='replace').read()
# root support text files
for rel in ['levels.m','map0.m','endingflowers.txt']:
    p=os.path.join(base,rel)
    if os.path.exists(p): texts['Data/'+rel]=open(p,encoding='utf-8',errors='replace').read()
for fn in sorted(os.listdir(os.path.join(base,'Languages'))):
    if fn.endswith('.txt'):
        p=os.path.join(base,'Languages',fn)
        texts['Data/Languages/'+fn]=open(p,encoding='utf-8',errors='replace').read()
# themes are small ini-like data used by custom levels/menu
for sub in ['Themes']:
    d=os.path.join(base,sub)
    for fn in sorted(os.listdir(d)):
        p=os.path.join(d,fn)
        if os.path.isfile(p): texts[f'Data/{sub}/{fn}']=open(p,encoding='utf-8',errors='replace').read()
spriteFiles={'root':sorted(fn for fn in os.listdir(os.path.join(base,'Sprites')) if fn.endswith('.png'))}
for world in sorted(os.listdir(wroot)):
    sd=os.path.join(wroot,world,'Sprites')
    if os.path.isdir(sd): spriteFiles[world]=sorted(fn for fn in os.listdir(sd) if fn.endswith('.png'))
bundle={'tiles':tiles,'nameToClass':nameToClass,'levels':levels,'texts':texts,'spriteFiles':spriteFiles}
os.makedirs(outdir,exist_ok=True)
with open(os.path.join(outdir,'game-data.json'),'w') as f: json.dump(bundle,f,separators=(',',':'))
print('tiles',len(tiles),'worlds',{k:len(v) for k,v in levels.items()},'texts',len(texts),'size',os.path.getsize(os.path.join(outdir,'game-data.json')))
