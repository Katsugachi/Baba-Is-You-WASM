(() => {
'use strict';

const DATA_ROOT = 'Base Files/Data/';
const SCRIPT_FILES = [
  'load.lua','syntax.lua','clears.lua','map.lua','movement.lua','blocks.lua','rules.lua','tools.lua','features.lua','undo.lua','values.lua','constants.lua','effects.lua','convert.lua','dynamictiling.lua','conditions.lua','changes.lua','colours.lua','metadata.lua','menu.lua','update.lua','ending.lua','mapcursor.lua','letterunits.lua','vision.lua','utf_decoder.lua','modsupport.lua','Editor/editor.lua','Editor/editor_constants.lua','Editor/editor_menudata.lua','Editor/editor_objectlist.lua','Editor/editor_objectlist_func.lua','Editor/editor_undo.lua','Editor/editor_tutorial.lua','Editor/Tutorials/tutodata.lua','debug.lua'
];

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}
function parseIni(text) {
  const out = {};
  let section = '';
  out[section] = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      if (!out[section]) out[section] = {};
    } else {
      const i = line.indexOf('=');
      if (i >= 0) out[section][line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return out;
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}

class Store {
  constructor(bundle) {
    this.bundle = bundle;
    this.files = {};
    this.current = {};
    this.memory = {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('baba-wasm-save') || '{}'); } catch (_) {}
    this.saveData = saved;
    for (const [path, text] of Object.entries(bundle.texts)) this.files[normPath(path)] = parseIni(text);
  }
  setFile(kind, path) {
    path = normPath(path);
    this.current[kind] = path;
    if (!this.files[path]) this.files[path] = parseIni('');
  }
  read(kind, group, item) {
    group = String(group || ''); item = String(item || '');
    if (kind === 'save') return (this.saveData[group] && this.saveData[group][item]) || '';
    if (kind === 'settings') {
      const v = this.memory.settings?.[group]?.[item];
      return v == null ? '' : String(v);
    }
    const file = this.files[this.current[kind] || ''] || {};
    const v = file[group]?.[item];
    return v == null ? '' : String(v);
  }
  store(kind, group, item, value) {
    group = String(group || ''); item = String(item || ''); value = String(value ?? '');
    if (kind === 'save') {
      if (!this.saveData[group]) this.saveData[group] = {};
      this.saveData[group][item] = value;
      try { localStorage.setItem('baba-wasm-save', JSON.stringify(this.saveData)); } catch (_) {}
      return;
    }
    if (kind === 'settings') {
      if (!this.memory.settings) this.memory.settings = {};
      if (!this.memory.settings[group]) this.memory.settings[group] = {};
      this.memory.settings[group][item] = value;
      return;
    }
    const path = this.current[kind] || '';
    if (!this.files[path]) this.files[path] = parseIni('');
    if (!this.files[path][group]) this.files[path][group] = {};
    this.files[path][group][item] = value;
  }
}

class Runtime {
  constructor(canvas, status, bundle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.status = status;
    this.bundle = bundle;
    this.objects = new Map();
    this.nextFixed = 10;
    this.store = new Store(bundle);
    this.images = new Map();
    this.tinted = new Map();
    this.palette = null;
    this.paletteReady = false;
    this.backcolour = [0, 4];
    this.keysDown = new Set();
    this.world = 'baba';
    this.level = '0level';
    this.levelMeta = null;
    this.width = 35; this.height = 20;
    this.tile = 24;
    this.tick = 0;
    this.events = [];
    this.classSprites = {};
    this.music = null;
    this.musicName = '';
    this.errorCount = 0;
    this.started = false;
    this.tilemap = this.makeTilemap(35, 20);
    this.transitioning = false;
  }

  log(...a) { console.log('[baba]', ...a); }
  warn(...a) { console.warn('[baba]', ...a); }
  setStatus(t) { this.status.textContent = t || ''; }

  makeTilemap(w, h) {
    const layers = [];
    const makeLayer = () => {
      const cells = new Uint8Array(w * h).fill(255);
      return {
        cells,
        get_x: (self, x, y) => {
          if (typeof self === 'number') { y = x; x = self; }
          x = Math.floor(x); y = Math.floor(y);
          return (x < 0 || y < 0 || x >= w || y >= h) ? 255 : cells[y * w + x];
        },
        set: (self, x, y, a, b) => {
          if (typeof self === 'number') { b = a; a = y; y = x; x = self; }
          x = Math.floor(x); y = Math.floor(y);
          if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = a & 255;
        }
      };
    };
    const tm = {};
    for (let i = 0; i < 4; i++) layers.push(makeLayer());
    tm[-1] = layers[0]; tm[0] = layers[1]; tm[1] = layers[2]; tm[2] = layers[3];
    tm.layers = layers;
    return tm;
  }

  makeObject(className) {
    className = String(className || 'error');
    const meta = this.bundle.tiles[className] || null;
    const fixed = this.nextFixed++;
    const values = {}, strings = {}, flags = {};
    for (let i = 0; i < 80; i++) { values[i] = 0; flags[i] = false; }
    for (let i = 0; i < 40; i++) strings[i] = '';
    values[1] = meta?.type || 0;
    values[2] = meta?.tiling ?? -1;
    values[5] = 3;
    values[14] = meta?.layer || 10;
    values[20] = -1;
    strings[0] = meta?.name?.replace(/^text_/, '') || className;
    strings[1] = meta?.unittype || 'object';
    strings[2] = meta?.name || className;
    const obj = {
      fixed, className, values, strings, flags,
      x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 0, layer: values[14], visible: true,
      sprite: this.classSprites[className] || meta?.sprite || meta?.name || className,
      root: meta?.root !== false,
      colour: meta?.colour ? [...meta.colour] : [0, 3],
      frame: 0, animspeed: 1, system: false, dead: false,
    };
    this.objects.set(fixed, obj);
    return obj;
  }
  makeSystemObject(className) {
    const o = this.makeObject(className);
    o.system = true;
    o.visible = false;
    return o;
  }
  obj(id) { return this.objects.get(Number(id)) || null; }
  removeObject(id) {
    const o = this.obj(id);
    if (o) { o.dead = true; o.values[0] = 0; this.objects.delete(o.fixed); }
  }

  expose() {
    const g = this.lua.global;
    const R = this;
    const retTable = arr => arr;
    const call = (name, ...args) => {
      try {
        const result = g.call('__safecall', name, ...args);
        if (result && result[0] === false) throw new Error(result[1] || ('Lua error in ' + name));
        return result && result.length > 1 ? result[1] : undefined;
      } catch (e) {
        R.reportLuaError(e, name);
      }
    };
    this.callLua = call;
    g.set('mmf', { newObject: id => this.obj(id) });
    g.set('TileMap', { new: id => this.tilemap });
    const api = {
      MF_alert: (...a) => R.log(...a),
      MF_debug: (...a) => R.log(...a),
      MF_log: () => {},
      MF_resetlog: () => {}, MF_savelog: () => {},
      MF_create: cls => R.makeObject(cls).fixed,
      MF_emptycreate: (cls, x, y) => {
        const o = R.makeObject(cls); o.values[3] = x || 0; o.values[4] = y || 0; return o.fixed;
      },
      MF_specialcreate: cls => { const o = R.makeObject('special_' + cls); o.visible = false; return o.fixed; },
      MF_effectcreate: cls => { const o = R.makeObject('effect_' + cls); o.visible = false; return o.fixed; },
      MF_remove: id => R.removeObject(id),
      MF_cleanremove: id => { const o=R.obj(id); const n=o?.strings?.[3]||''; R.removeObject(id); return n; },
      MF_cleanspecialremove: id => { R.removeObject(id); return ''; },
      MF_specialremove: id => R.removeObject(id),
      MF_findfixed: id => R.obj(id) ? Number(id) : null,
      MF_findunit_fixed: id => !!R.obj(id),
      MF_getfixed: id => {
        for (const o of R.objects.values()) if (o.values[20] === id) return o.fixed;
        return null;
      },
      MF_getunits: () => retTable([...R.objects.values()].filter(o => !o.system && !o.dead).map(o => o.fixed)),
      MF_totalunitcount: () => [...R.objects.values()].filter(o => !o.system && !o.dead).length,
      MF_getlist_system: () => [],
      MF_getlistlevel: () => [],
      MF_findpaths: () => [], MF_findgates: () => [], MF_findlevelunit: () => [], MF_findpath_id: () => null,
      MF_findspecial: () => [], MF_finddecor: () => null, MF_cleandecors: () => {},
      MF_update: () => {
        for (const n of ['doupdate','smallclear','code','fallblock','doupdate','code','conversion','fallblock','doupdate','code','levelblock','block','dolevelconversions','doupdate','smallclear','code','findplayer','effectblock','diceblock']) call(n);
      },
      MF_win: () => R.queueEvent('win'),
      MF_restart: immediate => R.queueEvent('restart'),
      MF_end: () => R.queueEvent('win'), MF_end_single: () => R.queueEvent('win'), MF_done_single: () => R.queueEvent('win'),
      MF_allisdone: () => R.queueEvent('win'), MF_intro: () => {}, MF_levelconversion: () => {}, MF_credits: () => {},
      MF_animframe: (id, f) => { const o=R.obj(id); if(o)o.frame=f; },
      MF_setframe: (id, f) => { const o=R.obj(id); if(o)o.frame=f; },
      MF_getframe: id => { const o=R.obj(id); return [o?.frame||0,0]; },
      MF_setbank: () => {}, MF_setanim: () => {}, MF_setanimspeed: (id,v)=>{const o=R.obj(id);if(o)o.animspeed=v;},
      MF_changesprite: (id, sprite, root) => {
        const o=R.obj(id); if(!o) return;
        o.sprite = sprite; o.root = !!root;
        R.classSprites[o.className] = sprite;
      },
      MF_restoredefaults: (id, name, root) => {
        const o=R.obj(id); if(!o) return;
        o.sprite = name; o.root = !!root; R.classSprites[o.className] = name;
      },
      MF_defaultsprite: () => {}, MF_loadsprite: () => {}, MF_loadsprite_special: () => {},
      MF_findsprite: () => true,
      MF_setcolour: (id, x, y) => { const o=R.obj(id); if(o)o.colour=[Number(x)||0,Number(y)||0]; },
      MF_setcolourfromstring: (id, s) => { const p=String(s).split(','); const o=R.obj(id); if(o)o.colour=[Number(p[0])||0,Number(p[1])||0]; },
      MF_defaultcolour: id => { const o=R.obj(id); if(o)o.colour=[0,3]; },
      MF_setdepthcolour: (id,x,y)=>{const o=R.obj(id);if(o)o.colour=[Number(x)||0,Number(y)||0];},
      MF_backcolour: (x,y) => { R.backcolour=[Number(x)||0,Number(y)||0]; },
      MF_backcolour_dim: (x,y) => { R.backcolour=[Number(x)||0,Number(y)||0]; },
      MF_setbackcolour: () => {},
      MF_getpalettedata: () => ['default.png',1], MF_getpalettename: () => 'default', MF_loadpalette: () => {},
      MF_updatelevelcolour: () => {}, MF_updatelevelcolours: () => {},
      MF_scrollroom: () => {}, MF_setroomoffset: () => {}, MF_resetobjectpos: () => {}, MF_levelrotation: () => {},
      MF_read: (kind, group, item) => R.store.read(kind, group, item),
      MF_store: (kind, group, item, value) => R.store.store(kind, group, item, value),
      MF_setfile: (kind, path) => R.store.setFile(kind, path),
      MF_parsestring: s => String(s || '').split(',').filter(x => x.length > 0),
      MF_parsestring_equals: s => String(s || '').split('=').filter(x => x.length > 0),
      MF_filelist: () => [], MF_dirlist: () => [], MF_findfile: () => false,
      MF_random: (a,b) => b === undefined ? Math.random() * (a || 1) : a + Math.floor(Math.random() * (b - a + 1)),
      MF_keydown: name => R.keysDown.has(String(name)),
      MF_keyid: id => String(id), MF_mouse: () => [0,0], MF_mousedown: () => false,
      MF_getkey: () => '', MF_setkey: () => {},
      MF_gamepadbuttonid: () => 0, MF_gamepadprofilename: () => '', MF_gamepadprofilename_string: n=>n,
      MF_gpad_profile_raw_to_string: () => '', MF_gpad_profile_string_to_raw: () => 0,
      MF_gpad_raw_to_string: () => '', MF_gpad_string_to_raw: () => 0, MF_profilefound: () => null,
      MF_getversion: () => '478f', MF_getprint: () => '', MF_debugmode: () => false,
      MF_playmusic: (song, local, channel, repeats) => R.playMusic(song, local),
      MF_musicstate: () => {}, MF_channelvolume: () => {},
      MF_playsound: () => {}, MF_playsound_channel: () => {}, MF_playsound_freq: () => {}, MF_playsound_full: () => {},
      MF_playsound_musicvolume: () => {}, MF_playsound_repeat: () => {}, MF_stopsound: () => {}, MF_loadsound: () => {}, MF_loadsound_root: () => {},
      MF_particle: () => null, MF_particles: () => {}, MF_particles_for_unit: () => {}, MF_staticparticle: () => null,
      MF_gateeffect: () => {}, MF_removeblockeffect: () => {}, MF_sound: () => {},
      MF_gettextwidth: (text, size) => String(text || '').length * (size || 1) * 6,
      MF_letter: () => null, MF_letterclear: () => {}, MF_letterhide: () => {}, MF_creditsletter: () => null, MF_creditsletterclear: () => {},
      MF_specialvisible: (id,st)=>{const o=R.obj(id);if(o)o.visible=!!st;}, MF_specialvisible_string: () => {}, MF_visible: () => {},
      MF_backimagepos: () => {}, MF_movebackimage: () => {}, MF_loadbackimage: () => {}, MF_setshader: () => {}, MF_setshadervar: () => {},
      MF_closevision: () => {}, MF_setupvision: () => {}, MF_setupvision_single: () => {}, MF_updatevision: () => {}, MF_updatevisionpos: () => {},
      MF_buttonicon: () => null, MF_buttonletterclear: () => {}, MF_disablebutton: () => {}, MF_disablebuttons: () => {},
      MF_getbutton: () => [], MF_getbuttongroup: () => [], MF_removebutton: () => {}, MF_updatebuttonicon: () => {},
      MF_clearthumbnails: () => {}, MF_thumbnail: () => null, MF_thumbnail_loadimage: () => {}, MF_thumbnail_updatecolour: () => {}, MF_thumbnail_updatesprite: () => {},
      MF_clearthumbnail_withowner: () => {}, MF_visible_thumbnail: () => {}, MF_thumbnail_tofront_hack: () => {},
      MF_addquickbar: () => {}, MF_removequickbar: () => {}, MF_hotbar_empty: () => {}, MF_hotbar_lock: () => {},
      MF_setpagemenu: () => {}, MF_getpagecount: () => 0, MF_menubackground: () => {}, MF_menuselector_hack: () => {},
      MF_cursorvisible: () => {}, MF_enabletextinput: () => {}, MF_editormarker: () => {}, MF_editor_enable: () => {},
      MF_loadtilemap: () => {}, MF_pickedtile: () => 0, MF_movetileplacer: () => {}, MF_showtileplacer: () => {},
      MF_currobjlist_back: () => {}, MF_currobjlist_backdel: () => {}, MF_updateobjlistname_hack: () => {}, MF_updateobjlistname_byname: () => {},
      MF_positioncurrobjselector: () => {}, MF_setobjlisttopleft: () => {}, MF_getobjbuttonid: () => 0,
      MF_leveldata: () => {}, MF_savelevel: () => {}, MF_savepath: () => {}, MF_massdir: () => {}, MF_sublayer: () => {}, MF_setsublayer: () => {},
      MF_clearborders: () => {}, MF_limitsize: () => {}, MF_loadcolourselector: () => {}, MF_loadpackicon: () => {},
      MF_loop: () => {}, MF_unfinished: () => false, MF_hack_movecredit: () => {}, MF_hack_removecredit: () => {},
      MF_setart: () => {}, MF_setnamegiving: () => {}, MF_tutorialbackground: () => {},
      MF_bonus: () => {}, MF_checkcustompathobject: () => false,
    };
    for (const [k, v] of Object.entries(api)) g.set(k, v);
  }

  reportLuaError(e, where) {
    this.errorCount++;
    console.error('[lua]', where, e);
    if (this.errorCount < 8) this.setStatus(`Lua error in ${where}: ${e?.message || e}`);
  }
  queueEvent(name) {
    if (!this.events.includes(name)) this.events.push(name);
  }

  async loadScripts() {
    for (const f of SCRIPT_FILES) {
      const url = DATA_ROOT + (f.startsWith('Editor/') ? 'Editor/' + f.slice(7) : f);
      const resp = await fetch(encodeURI(url));
      const text = await resp.text();
      try { this.lua.doStringSync(text); }
      catch (e) { this.reportLuaError(e, f); throw e; }
    }
  }

  setupObjects() {
    this.system = {};
    for (const n of ['generaldata','generaldata2','generaldata3','generaldata4','generaldata5','spritedata','vardata','editor','editor2','editor3','editor4','editor_selector','editor_placer']) {
      this.system[n] = this.makeSystemObject(n);
    }
    const gd=this.system.generaldata, gd2=this.system.generaldata2, gd3=this.system.generaldata3, gd4=this.system.generaldata4, gd5=this.system.generaldata5, sd=this.system.spritedata;
    gd.values[2]=0; gd.values[8]=1; gd.strings[1]=this.world; gd.strings[8]=this.world; gd.strings[7]='en'; gd.strings[5]='wasm';
    gd.flags[4]=false;
    gd2.values[12]=1; gd2.values[22]=1; gd2.values[20]=10;
    gd3.values[4]=50; gd3.values[5]=50; gd3.values[6]=150;
    gd4.values[22]=0;
    gd5.values[15]=0; gd5.values[16]=0; gd5.values[17]=0;
    sd.values[0]=24; sd.values[1]=1; sd.values[2]=1; sd.values[8]=24; sd.values[16]=0; sd.values[20]=1;
  }

  luaBootstraps() {
    return `
function __import_level_changes()
  local changelists = tonumber(MF_read("level","tiles","changed_count")) or 1
  changelists = math.max(changelists, 1)
  local seen = {}
  for i=1,changelists do
    local id = "changed"
    if (i > 1) then id = id .. tostring(i) end
    local changestring = MF_read("level","tiles",id)
    for obj in string.gmatch(changestring, "%w+") do
      if (string.sub(obj, 1, 6) == "object") and (string.len(obj) == 9) and (tonumber(string.sub(obj, -3)) ~= nil) then
        if seen[obj] == nil then
          seen[obj] = true
          local params = {}
          local keys = {"name","image","colour","tiling","type","unittype","activecolour","root","layer","argtype","argextra","customobjects"}
          for n,key in ipairs(keys) do
            local v = MF_read("level","tiles",obj .. "_" .. key)
            if (string.len(v) > 0) then params[n] = v end
          end
          savechange(obj,params,0)
        end
      end
    end
  end
end
`;
  }

  async bootLevel(world, level) {
    this.world = world; this.level = level;
    this.transitioning = true;
    this.setStatus('loading ' + level + '…');
    this.objects.clear(); this.nextFixed = 10; this.classSprites = {};
    this.stopMusic();
    const info = this.bundle.levels[world]?.[level];
    if (!info) throw new Error('missing level ' + world + '/' + level);
    this.width = info.w; this.height = info.h;
    this.tilemap = this.makeTilemap(info.w, info.h);
    this.canvas.width = info.w * this.tile;
    this.canvas.height = info.h * this.tile;
    this.store.setFile('level', `Data/Worlds/${world}/${level}.ld`);
    this.store.setFile('world', `Data/Worlds/${world}/world_data.txt`);
    this.store.setFile('lang', 'Data/Languages/lang_en.txt');

    const factory = new wasmoon.LuaFactory('web/vendor/glue.wasm');
    this.lua = await factory.createEngine({ enableProxy: true, injectObjects: false });
    this.expose();
    this.lua.global.set('__native_dofile', this.lua.global.get('dofile'));
    this.lua.doStringSync('function dofile(path) return nil end');
    await this.loadScripts();
    this.setupObjects();
    this.lua.doStringSync('function __safecall(name, ...) local f = _G[name]; if type(f) ~= \"function\" then return false, \"missing function \" .. tostring(name) end; return pcall(f, ...) end');
    this.lua.doStringSync(this.luaBootstraps());
    const s=this.system;
    const args=[0,info.w,info.h,12,0,0,s.generaldata.fixed,s.generaldata2.fixed,s.generaldata3.fixed,s.generaldata4.fixed,s.generaldata5.fixed,s.spritedata.fixed,s.vardata.fixed,info.w*this.tile,info.h*this.tile];
    this.callLua('init',...args);
    this.callLua('setupmenu',s.editor.fixed,s.editor2.fixed,s.editor3.fixed,s.editor4.fixed,s.editor_selector.fixed,s.editor_placer.fixed,true);
    this.callLua('__import_level_changes');
    this.callLua('worldinit');
    this.callLua('handleobjectchanges');
    this.callLua('createobjectpalette');
    this.callLua('clearunits');

    const tileToClass = {};
    for (const [cls,m] of Object.entries(this.bundle.tiles)) tileToClass[m.tile.join(',')] = cls;
    const placements=[];
    for (let layer=0; layer<info.layers.length; layer++) {
      for (const p of info.layers[layer]) {
        if (p.x===0||p.y===0||p.x===info.w-1||p.y===info.h-1) continue;
        const cls=tileToClass[p.tx+','+p.ty];
        if (!cls || cls==='edge') continue;
        placements.push({cls,x:p.x,y:p.y,d:p.d});
      }
    }
    for (const p of placements) {
      const o=this.makeObject(p.cls);
      o.values[0]=1; o.values[3]=p.x; o.values[4]=p.y; o.values[5]=p.d; o.values[20]=-1;
      this.callLua('addunit',o.fixed,false,true);
    }
    this.callLua('levelborder');
    this.callLua('setunitmap');
    this.callLua('code');
    this.callLua('effectblock');
    if ((this.store.read('level','general','music') || '') !== '') this.playMusic(this.store.read('level','general','music'),0);
    else this.playMusic('baba',0);
    this.started = true;
    this.transitioning = false;
    this.setStatus('');
    this.canvas.focus();
  }

  playMusic(song, local) {
    song = String(song || '').replace(/\.ogg$/,'');
    if (!song || song === this.musicName) return;
    this.stopMusic();
    const path = local ? `${DATA_ROOT}Worlds/${this.world}/Music/${song}.ogg` : `${DATA_ROOT}Music/${song}.ogg`;
    const a = new Audio(encodeURI(path));
    a.loop = true; a.volume = 0.35;
    a.play().catch(() => {});
    this.music = a; this.musicName = song;
  }
  stopMusic() { if (this.music) { this.music.pause(); this.music = null; this.musicName=''; } }

  async handleEvents() {
    if (!this.events.length || this.transitioning) return;
    const ev = this.events.shift();
    if (ev === 'restart') {
      await this.bootLevel(this.world,this.level);
    } else if (ev === 'win') {
      this.setStatus('level complete');
      const m = /^(\d+)level$/.exec(this.level);
      let next = null;
      if (m) {
        const n = String(Number(m[1]) + 1) + 'level';
        if (this.bundle.levels[this.world]?.[n]) next = n;
      }
      setTimeout(() => { if (next) this.bootLevel(this.world,next).catch(e=>this.reportLuaError(e,'transition')); else this.setStatus('level complete'); }, 700);
    }
  }

  input(name) {
    if (!this.started || this.transitioning) return;
    try {
      if (name === 'undo') this.callLua('undo');
      else this.callLua('command', name);
    } catch (e) { this.reportLuaError(e, name); }
  }

  paletteColor(x, y, dim=false) {
    if (!this.paletteReady) return [255,255,255];
    const w=7,h=5;
    x=clamp(Math.floor(x)||0,0,w-1); y=clamp(Math.floor(y)||0,0,h-1);
    const i=(y*w+x)*3;
    let r=this.palette[i],g=this.palette[i+1],b=this.palette[i+2];
    if (dim) { r*=.25; g*=.25; b*=.25; }
    return [r,g,b];
  }

  imagePath(obj, dir, frame) {
    const base = obj.root === false ? `${DATA_ROOT}Worlds/${this.world}/Sprites/` : `${DATA_ROOT}Sprites/`;
    return encodeURI(`${base}${obj.sprite}_${dir}_${frame}.png`);
  }
  getImage(path) {
    let rec=this.images.get(path);
    if (!rec) {
      rec={img:new Image(),ready:false};
      rec.img.onload=()=>{rec.ready=true};
      rec.img.src=path;
      this.images.set(path,rec);
    }
    return rec.ready ? rec.img : null;
  }
  tintedImage(obj, dir, frame) {
    const path=this.imagePath(obj,dir,frame);
    const key=path+'|'+obj.colour.join(',');
    let rec=this.tinted.get(key);
    if (rec && rec.ready) return rec.canvas;
    if (!rec) {
      rec={ready:false,canvas:document.createElement('canvas')};
      this.tinted.set(key,rec);
    }
    const img=this.getImage(path);
    if (!img) return null;
    try {
      rec.canvas.width=img.width; rec.canvas.height=img.height;
      const c=rec.canvas.getContext('2d');
      c.drawImage(img,0,0);
      const data=c.getImageData(0,0,img.width,img.height);
      const col=this.paletteColor(obj.colour[0],obj.colour[1]);
      for (let i=0;i<data.data.length;i+=4) {
        const a=data.data[i+3];
        if (a===0) continue;
        const lum=data.data[i]/255;
        data.data[i]=col[0]*lum;
        data.data[i+1]=col[1]*lum;
        data.data[i+2]=col[2]*lum;
      }
      c.putImageData(data,0,0);
      rec.ready=true;
      return rec.canvas;
    } catch(e) { return img; }
  }

  spriteDir(obj) {
    const tiling=obj.values[2];
    if (tiling===1) return clamp(Math.floor(obj.direction)||0,0,31);
    if (tiling===2||tiling===3) {
      const vd=Math.floor(obj.values[9]||0);
      return (((Math.floor(obj.values[5]||0)*8+vd)%32)+32)%32;
    }
    return 0;
  }

  render() {
    const ctx=this.ctx;
    const bg=this.paletteColor(this.backcolour[0],this.backcolour[1]);
    ctx.fillStyle=`rgb(${bg[0]|0},${bg[1]|0},${bg[2]|0})`;
    ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    if (!this.started) return;
    const objs=[...this.objects.values()].filter(o=>!o.system&&!o.dead&&o.visible!==false&&o.className!=='edge');
    objs.sort((a,b)=>(a.values[14]-b.values[14])||(a.fixed-b.fixed));
    ctx.imageSmoothingEnabled=false;
    for (const o of objs) {
      const x=(o.values[3]+0.5)*this.tile, y=(o.values[4]+0.5)*this.tile;
      const frame=((Math.floor(this.tick/12)+(o.frame||0))%3)+1;
      let img=this.tintedImage(o,this.spriteDir(o),frame);
      if (!img) img=this.tintedImage(o,0,frame) || this.tintedImage(o,this.spriteDir(o),1) || this.tintedImage(o,0,1);
      if (!img) continue;
      const w=this.tile,h=this.tile;
      if (o.values[17]===true || o.flags?.[17]===true) ctx.globalAlpha=.35;
      ctx.drawImage(img,Math.round(x-w/2),Math.round(y-h/2),w,h);
      ctx.globalAlpha=1;
    }
  }

  async loadPalette() {
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=encodeURI(DATA_ROOT+'Palettes/default.png')});
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const x=c.getContext('2d');x.drawImage(img,0,0);
    const d=x.getImageData(0,0,img.width,img.height).data;
    this.palette=new Uint8Array(img.width*img.height*3);
    for(let i=0,j=0;i<d.length;i+=4,j+=3){this.palette[j]=d[i];this.palette[j+1]=d[i+1];this.palette[j+2]=d[i+2]}
    this.paletteReady=true;
  }

  async start() {
    this.setStatus('loading data…');
    await this.loadPalette();
    await this.bootLevel(this.world,this.level);
    const loop=()=>{
      this.tick++;
      this.handleEvents().catch(e=>this.reportLuaError(e,'event'));
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

async function main() {
  const status=document.getElementById('status');
  try {
    const bundleResp = await fetch('web/game-data.json');
    const bundle=await bundleResp.json();
    const rt=new Runtime(document.getElementById('game'),status,bundle);
    window.babaRuntime=rt;
    const keymap={ArrowRight:'right',ArrowUp:'up',ArrowLeft:'left',ArrowDown:'down',z:'undo',Z:'undo',r:'restart_instant',R:'restart_instant',' ':'idle',Enter:'idle'};
    window.addEventListener('keydown',e=>{
      const k=keymap[e.key];
      if(k){e.preventDefault();rt.keysDown.add(k);rt.input(k)}
    });
    window.addEventListener('keyup',e=>{const k=keymap[e.key];if(k)rt.keysDown.delete(k)});
    await rt.start();
  } catch(e) {
    console.error(e);
    status.textContent='failed to load: '+(e?.message||e);
  }
}
main();
})();
