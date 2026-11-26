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
    this.titleVisible = true;
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
      MF_specialcreate: cls => { const o = R.makeObject(cls); o.pixel = true; return o.fixed; },
      MF_effectcreate: cls => { const o = R.makeObject(cls); o.pixel = true; return o.fixed; },
      MF_remove: id => R.removeObject(id),
      MF_cleanremove: id => { const o=R.obj(id); const n=o?.strings?.[0]||''; R.removeObject(id); return n; },
      MF_cleanspecialremove: id => { R.removeObject(id); return ''; },
      MF_delete: () => {}, MF_clearcontrolicons: () => {}, MF_findunit_editor: () => null,
      MF_getlevelcount: () => 0, MF_getprofileID: () => 0, MF_pickobject: () => null,
      MF_removecounter: () => {}, MF_setbuttongrid: () => {}, MF_tutorialbackgroundfade: () => {},
      MF_deletesave_group: group => { if (R.store.saveData) delete R.store.saveData[String(group||'')]; },
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
        for (const n of ['doupdate','smallclear','code','fallblock','doupdate','code','conversion','fallblock','doupdate','code','levelblock','block','dolevelconversions','doupdate','smallclear','code','findplayer','effectblock','diceblock','newundo']) call(n);
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
      MF_leveldata: () => {}, MF_savelevel: () => {}, MF_savepath: () => {}, MF_massdir: () => {}, MF_sublayer: (layer,x,y) => R.tilemap.layers[Number(layer)||0]?.get_x(null,x,y) ?? 255, MF_setsublayer: (layer,x,y,value,dir) => R.tilemap.layers[Number(layer)||0]?.set(null,x,y,value,dir),
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
    sd.values[0]=24; sd.values[1]=1; sd.values[2]=2; sd.values[8]=24; sd.values[16]=0; sd.values[20]=1;
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

__objectcache = {}
local function __mirrorobjecttable(backing, limit)
  local data = {}
  local mirrored = {}
  for i=0,limit do
    data[i] = backing[i]
  end
  setmetatable(mirrored, {
    __index = function(_, key)
      return data[key]
    end,
    __newindex = function(_, key, value)
      data[key] = value
      backing[key] = value
    end
  })
  return mirrored
end

local function __mirrorobject(backing)
  local data = {}
  local mirrored = {}
  data.values = __mirrorobjecttable(backing.values, 80)
  data.strings = __mirrorobjecttable(backing.strings, 80)
  data.flags = __mirrorobjecttable(backing.flags, 80)
  local scalarkeys = {"fixed","className","x","y","scaleX","scaleY","direction","layer","visible","sprite","root","dead","frame","active","system"}
  for _,key in ipairs(scalarkeys) do
    data[key] = backing[key]
  end
  setmetatable(mirrored, {
    __index = function(_, key)
      local value = data[key]
      if (value ~= nil) then return value end
      return backing[key]
    end,
    __newindex = function(_, key, value)
      data[key] = value
      if (type(value) ~= "table") and (key ~= "values") and (key ~= "strings") and (key ~= "flags") then
        backing[key] = value
      end
    end
  })
  return mirrored
end

if (mmf ~= nil) and (type(mmf.newObject) == "function") then
  local nativenewobject = mmf.newObject
  mmf = {
    newObject = function(fixed)
      local cached = __objectcache[fixed]
      if (cached ~= nil) then return cached end
      local backing = nativenewobject(fixed)
      if (backing == nil) then return nil end
      local mirrored = __mirrorobject(backing)
      __objectcache[fixed] = mirrored
      return mirrored
    end
  }
end

if (type(clearunits) == "function") then
  local nativeclearunits = clearunits
  clearunits = function(...)
    local preserved = {}
    for fixed,unit in pairs(__objectcache) do
      if unit.system then preserved[fixed] = unit end
    end
    local result = nativeclearunits(...)
    __objectcache = preserved
    return result
  end
end

if (type(MF_remove) == "function") then
  local nativemfremove = MF_remove
  MF_remove = function(fixed)
    __objectcache[fixed] = nil
    return nativemfremove(fixed)
  end
end
`;
  }

  async bootLevel(world, level) {
    this.world = world; this.level = level;
    this.transitioning = true;
    this.setStatus('loading ' + level + '…');
    if (this.lua) this.lua.doStringSync('__objectcache = {}');
    this.objects.clear(); this.nextFixed = 10; this.classSprites = {};
    this.stopMusic();
    const info = this.bundle.levels[world]?.[level];
    if (!info) throw new Error('missing level ' + world + '/' + level);
    this.width = info.w; this.height = info.h;
    this.tilemap = this.makeTilemap(info.w, info.h);
    this.canvas.width = info.w * this.tile;
    this.canvas.height = info.h * this.tile;
    this.resizeCanvas();
    this.store.setFile('level', `Data/Worlds/${world}/${level}.ld`);
    this.store.setFile('world', `Data/Worlds/${world}/world_data.txt`);
    this.store.setFile('lang', 'Data/Languages/lang_en.txt');
    try { localStorage.setItem('baba-wasm-current', JSON.stringify({world, level})); } catch (_) {}
    this.parentMapCache={};
    this.mapData=null;
    this.mapMode=false;

    if (!this.lua) {
      const factory = new wasmoon.LuaFactory('web/vendor/glue.wasm');
      this.lua = await factory.createEngine({ enableProxy: true, injectObjects: false });
      this.expose();
      this.lua.global.set('__native_dofile', this.lua.global.get('dofile'));
      this.lua.doStringSync('function dofile(path) return nil end');
      await this.loadScripts();
      this.lua.doStringSync('if math.atan2 == nil then math.atan2 = function(y,x) return math.atan(y,x) end end');
      this.lua.doStringSync('function __safecall(name, ...) local f = _G[name]; if type(f) ~= \"function\" then return false, \"missing function \" .. tostring(name) end; return pcall(f, ...) end');
      this.lua.doStringSync(this.luaBootstraps());
    }
    this.setupObjects();
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
      o.direction = p.d * 8;
      this.callLua('addunit',o.fixed,false,true);
    }
    this.callLua('levelborder');
    this.callLua('setunitmap');
    this.callLua('code');
    this.callLua('effectblock');
    if ((this.store.read('level','general','music') || '') !== '') this.playMusic(this.store.read('level','general','music'),0);
    else this.playMusic('baba',0);
    this.mapData=this.readMapData();
    this.mapMode=!!this.mapData;
    if(this.mapMode) this.refreshMapUnlocks();
    this.started = true;
    const selector=document.getElementById('level-select');
    if (selector) selector.value=this.world+'/'+this.level;
    this.transitioning = false;
    this.setStatus('');
    this.canvas.focus();
  }

  levelMeta(world, level) {
    return this.store.files[`Data/Worlds/${world}/${level}.ld`]?.general || {};
  }

  readMapData() {
    const meta=this.levelMeta(this.world,this.level);
    if (Number(meta.leveltype)!==1 || (Number(meta.levels)||0)===0) return null;
    const data={nodes:[],paths:[],selector:[Number(meta.selectorX)||1,Number(meta.selectorY)||1]};
    const read=(sec,i,key)=>this.store.files[`Data/Worlds/${this.world}/${this.level}.ld`]?.[sec]?.[`${i}${key}`];
    const levels=Number(meta.levels)||0;
    for(let i=0;i<levels;i++) {
      const file=read('levels',i,'file');
      if (!file) continue;
      data.nodes.push({
        file,x:Number(read('levels',i,'X'))||0,y:Number(read('levels',i,'Y'))||0,
        state:Number(read('levels',i,'state'))||0,number:Number(read('levels',i,'number'))||0,
        style:Number(read('levels',i,'style'))||0,
      });
    }
    const paths=Number(meta.paths)||0;
    for(let i=0;i<paths;i++) data.paths.push({x:Number(read('paths',i,'X'))||0,y:Number(read('paths',i,'Y'))||0});
    data.nodeAt=new Map(data.nodes.map(n=>[n.x+','+n.y,n]));
    data.pathSet=new Set(data.paths.map(p=>p.x+','+p.y));
    data.edges=new Map(data.nodes.map(n=>[n.file,new Set()]));
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    for(const start of data.nodes) {
      const seen=new Set([start.x+','+start.y]);
      const queue=[[start.x,start.y]];
      while(queue.length) {
        const [x,y]=queue.shift();
        for(const [dx,dy] of dirs) {
          const nx=x+dx,ny=y+dy,key=nx+','+ny;
          if(seen.has(key)) continue;
          seen.add(key);
          const other=data.nodeAt.get(key);
          if(other) {
            if(other!==start) data.edges.get(start.file).add(other.file);
            continue;
          }
          if(data.pathSet.has(key)) queue.push([nx,ny]);
        }
      }
    }
    return data;
  }

  completion(file) {
    return Number(this.store.saveData[this.world]?.[file] || 0);
  }

  mapProgress(mapFile) {
    const meta=this.store.files[`Data/Worlds/${this.world}/${mapFile}.ld`]?.general || {};
    const required=Number(meta.unlockcount)||0;
    if(!required) return false;
    const levels=this.store.files[`Data/Worlds/${this.world}/${mapFile}.ld`]?.levels || {};
    const total=Number(meta.levels)||0;
    let cleared=0;
    for(let i=0;i<total;i++) if(this.completion(levels[`${i}file`])>=3) cleared++;
    return cleared>=required;
  }

  refreshMapUnlocks() {
    const data=this.mapData;
    if(!data) return;
    data.unlocked=new Set();
    for(const n of data.nodes) if(n.state>=2 || this.completion(n.file)>0) data.unlocked.add(n.file);
    let changed=true;
    while(changed) {
      changed=false;
      for(const n of data.nodes) {
        if(this.completion(n.file)>=3 || this.mapProgress(n.file)) {
          for(const next of data.edges.get(n.file)||[]) {
            if(!data.unlocked.has(next)) { data.unlocked.add(next); changed=true; }
          }
        }
      }
    }
    if(!data.unlocked.size && data.nodes[0]) data.unlocked.add(data.nodes[0].file);
    if(!this.mapCursor || !data.nodes.some(n=>n.file===this.mapCursor && data.unlocked.has(n.file))) {
      const current=data.nodes.find(n=>n.file===this.previousPuzzle && data.unlocked.has(n.file));
      const initial=data.nodes.find(n=>n.x===data.selector[0]&&n.y===data.selector[1]&&data.unlocked.has(n.file));
      this.mapCursor=(current||initial||data.nodes.find(n=>data.unlocked.has(n.file))||data.nodes[0])?.file;
    }
  }

  findParentMap(world, level) {
    if(this.parentMapCache?.[world+'/'+level]) return this.parentMapCache[world+'/'+level];
    if(!this.parentMapCache) this.parentMapCache={};
    let found=null;
    for(const candidate of Object.keys(this.bundle.levels[world]||{})) {
      const meta=this.store.files[`Data/Worlds/${world}/${candidate}.ld`];
      if(Number(meta?.general?.leveltype)!==1) continue;
      const count=Number(meta.general.levels)||0;
      for(let i=0;i<count;i++) {
        if(meta.levels?.[`${i}file`]===level) { found=candidate; break; }
      }
      if(found) break;
    }
    this.parentMapCache[world+'/'+level]=found;
    return found;
  }

  moveMapCursor(name) {
    const data=this.mapData;
    if(!data||!this.mapCursor) return;
    const cur=data.nodes.find(n=>n.file===this.mapCursor);
    if(!cur) return;
    const vec={right:[1,0],up:[0,-1],left:[-1,0],down:[0,1]}[name];
    if(!vec) return;
    const linked=[...(data.edges.get(cur.file)||[])].map(f=>data.nodes.find(n=>n.file===f)).filter(n=>n&&data.unlocked.has(n.file));
    let best=null,bestScore=-Infinity;
    for(const n of linked) {
      const dx=n.x-cur.x,dy=n.y-cur.y;
      const forward=dx*vec[0]+dy*vec[1];
      if(forward<=0) continue;
      const sideways=Math.abs(dx*vec[1]-dy*vec[0]);
      const score=forward*10-sideways*4-Math.abs(dx)-Math.abs(dy);
      if(score>bestScore){best=n;bestScore=score}
    }
    if(!best) {
      const candidates=data.nodes.filter(n=>data.unlocked.has(n.file)&&n!==cur);
      for(const n of candidates) {
        const dx=n.x-cur.x,dy=n.y-cur.y;
        const forward=dx*vec[0]+dy*vec[1];
        if(forward<=0) continue;
        const sideways=Math.abs(dx*vec[1]-dy*vec[0]);
        const score=forward*4-sideways*8-Math.abs(dx)-Math.abs(dy);
        if(score>bestScore){best=n;bestScore=score}
      }
    }
    if(best){this.mapCursor=best.file; this.render();}
  }

  enterMapCursor() {
    const data=this.mapData;
    const node=data?.nodes.find(n=>n.file===this.mapCursor);
    if(node&&data.unlocked.has(node.file)&&this.bundle.levels[this.world]?.[node.file]) {
      this.bootLevel(this.world,node.file).catch(e=>this.reportLuaError(e,'enter level'));
    }
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
      this.store.store('save',this.world,this.level,'3');
      const completed=this.level;
      const parent=this.findParentMap(this.world,completed);
      let next=null;
      if(parent) {
        this.previousPuzzle=completed;
        next=parent;
      } else {
        const m = /^(\d+)level$/.exec(this.level);
        if (m) {
          const n = String(Number(m[1]) + 1) + 'level';
          if (this.bundle.levels[this.world]?.[n] && Number(this.levelMeta(this.world,n).leveltype)!==1) next=n;
        }
      }
      setTimeout(() => { if (next) this.bootLevel(this.world,next).catch(e=>this.reportLuaError(e,'transition')); else this.setStatus('level complete'); }, 700);
    }
  }

  input(name) {
    if (this.titleVisible || !this.started || this.transitioning || this.events.length) return;
    if (this.music && this.music.paused) this.music.play().catch(() => {});
    if (this.mapMode) {
      if (name === 'idle') this.enterMapCursor();
      else this.moveMapCursor(name);
      return;
    }
    try {
      if (name === 'undo') {
        this.callLua('undo');
        for (const n of ['doupdate','smallclear','code','doupdate','code','doupdate','smallclear','code','findplayer','effectblock','diceblock']) this.callLua(n);
      } else this.callLua('command', name);
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
      const x=o.pixel ? o.x : (o.values[3]+0.5)*this.tile;
      const y=o.pixel ? o.y : (o.values[4]+0.5)*this.tile;
      const frame=((Math.floor(this.tick/12)+(o.frame||0))%3)+1;
      let img=this.tintedImage(o,this.spriteDir(o),frame);
      if (!img) img=this.tintedImage(o,0,frame) || this.tintedImage(o,this.spriteDir(o),1) || this.tintedImage(o,0,1);
      if (!img) continue;
      const w=this.tile*(o.scaleX||1),h=this.tile*(o.scaleY||1);
      if (o.values[17]===true || o.flags?.[17]===true) ctx.globalAlpha=.35;
      ctx.drawImage(img,Math.round(x-w/2),Math.round(y-h/2),w,h);
      ctx.globalAlpha=1;
    }
    this.renderControlSpecials(ctx);
    this.renderTitle(ctx);
    if(this.mapMode&&this.mapData) {
      const data=this.mapData;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 8px monospace';
      for(const p of data.paths) {
        ctx.fillStyle='rgba(150,120,70,.45)';
        ctx.fillRect(p.x*this.tile+8,p.y*this.tile+10,8,4);
      }
      for(const n of data.nodes) {
        const unlocked=data.unlocked?.has(n.file),done=this.completion(n.file)>=3,selected=n.file===this.mapCursor;
        const cx=(n.x+.5)*this.tile,cy=(n.y+.5)*this.tile;
        ctx.fillStyle=done?'#e6d264':unlocked?'#b88746':'#292929';
        ctx.strokeStyle=selected?'#ffffff':unlocked?'#806040':'#151515';
        ctx.lineWidth=selected?2:1;
        ctx.fillRect(cx-9,cy-9,18,18);
        ctx.strokeRect(cx-9,cy-9,18,18);
        ctx.fillStyle=done?'#5a4b00':unlocked?'#201000':'#666';
        ctx.fillText(String(n.number),cx,cy+1);
      }
    }
  }

  renderTitle(ctx) {
    if(!this.titleVisible) return;
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    const title=this.getImage('web/assets/title.png');
    if(title) {
      const scale=Math.min(1,(this.canvas.width-48)/title.width);
      const w=title.width*scale,h=title.height*scale;
      ctx.drawImage(title,(this.canvas.width-w)/2,24,w,h);
    }
    const press=this.getImage('web/assets/press_any_key.png');
    if(press && Math.floor(this.tick/30)%2===0) {
      const scale=Math.min(1,this.canvas.width/press.width*.42);
      const w=press.width*scale,h=press.height*scale;
      ctx.drawImage(press,(this.canvas.width-w)/2,this.canvas.height-h-32,w,h);
    }
  }

  controlSpecials() {
    const meta=this.store.files[`Data/Worlds/${this.world}/${this.level}.ld`] || {};
    const count=Math.min(Number(meta.general?.specials)||0,100);
    const result=[];
    for(let i=0;i<count;i++) {
      const data=meta.specials?.[`${i}data`] || '';
      const parts=data.split(',');
      if(parts[0]!=='controls') continue;
      result.push({
        x:Number(meta.specials?.[`${i}X`])||0,
        y:Number(meta.specials?.[`${i}Y`])||0,
        control:parts[1]||'right'
      });
    }
    return result;
  }

  renderControlSpecials(ctx) {
    const specials=this.controlSpecials();
    if(!specials.length) return;
    const dirs={right:0,up:8,left:16,down:24};
    let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
    for(const s of specials) { minx=Math.min(minx,s.x);maxx=Math.max(maxx,s.x);miny=Math.min(miny,s.y);maxy=Math.max(maxy,s.y); }
    for(const s of specials) {
      const cx=(s.x+0.5)*this.tile,cy=(s.y+0.5)*this.tile,r=this.tile*0.42;
      ctx.fillStyle='rgba(0,0,0,.45)';
      ctx.strokeStyle='rgba(255,255,255,.92)';
      ctx.lineWidth=Math.max(1.5,this.tile/12);
      ctx.beginPath();
      ctx.roundRect(cx-r,cy-r,r*2,r*2,this.tile/6);
      ctx.fill();ctx.stroke();
      const arrow={sprite:'arrow',root:true,colour:[0,3],values:{2:1,5:dirs[s.control]??0,9:0},direction:(dirs[s.control]??0)*8,frame:0,className:'arrow'};
      const img=this.tintedImage(arrow,dirs[s.control]??0,1);
      if(img) ctx.drawImage(img,cx-r*.62,cy-r*.62,r*1.24,r*1.24);
    }
    const control=specials[0].control;
    const label={sprite:'button_'+({up:'move',down:'move',left:'move',right:'move',undo:'undo',restart:'restart',idle:'wait',wait:'wait',menu:'menu'}[control]||control),root:false,colour:[0,3],values:{2:0,5:0,9:0},direction:0,frame:0,className:'button'};
    const img=this.tintedImage(label,0,((Math.floor(this.tick/12))%3)+1);
    if(img) {
      const cx=(minx+maxx+1)/2*this.tile;
      const y=(maxy+1)*this.tile+this.tile*.25;
      ctx.drawImage(img,cx-this.tile,y,this.tile*2,this.tile);
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

  resizeCanvas() {
    const scale = Math.min(window.innerWidth / this.canvas.width, window.innerHeight / this.canvas.height);
    this.canvas.style.width = Math.floor(this.canvas.width * scale) + 'px';
    this.canvas.style.height = Math.floor(this.canvas.height * scale) + 'px';
  }

  async start() {
    this.setStatus('loading data…');
    window.addEventListener('resize', () => this.resizeCanvas());
    await this.loadPalette();
    try {
      const saved=JSON.parse(localStorage.getItem('baba-wasm-current')||'null');
      if(saved&&this.bundle.levels[saved.world]?.[saved.level]) { this.world=saved.world; this.level=saved.level; }
    } catch (_) {}
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

function populateLevelSelect(rt) {
  const select=document.getElementById('level-select');
  const natural=(a,b)=>a.localeCompare(b,undefined,{numeric:true});
  for (const world of Object.keys(rt.bundle.levels).sort()) {
    const group=document.createElement('optgroup');
    group.label=world;
    for (const level of Object.keys(rt.bundle.levels[world]).sort(natural)) {
      const option=document.createElement('option');
      option.value=world+'/'+level;
      const meta=rt.store.files[`Data/Worlds/${world}/${level}.ld`]?.general || {};
      option.textContent=level+(meta.name?` — ${meta.name}`:'');
      if (world===rt.world&&level===rt.level) option.selected=true;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  select.addEventListener('change',()=>{
    const [world,level]=select.value.split('/');
    rt.bootLevel(world,level).catch(e=>rt.reportLuaError(e,'level select'));
    rt.canvas.focus();
  });
}

async function main() {
  const status=document.getElementById('status');
  try {
    const bundleResp = await fetch('web/game-data.json');
    const bundle=await bundleResp.json();
    const rt=new Runtime(document.getElementById('game'),status,bundle);
    window.babaRuntime=rt;
    populateLevelSelect(rt);
    const keymap={ArrowRight:'right',ArrowUp:'up',ArrowLeft:'left',ArrowDown:'down',z:'undo',Z:'undo',r:'restart_instant',R:'restart_instant',' ':'idle',Enter:'idle'};
    window.addEventListener('keydown',e=>{
      const k=keymap[e.key];
      if(rt.titleVisible){e.preventDefault();rt.titleVisible=false;rt.canvas.focus();return}
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
