mod_hook_functions =
{
	level_start =
	{
		-- Functions added to this table will be called on level start.
	},
	level_end =
	{
		-- Functions added to this table will be called on level end.
	},
	level_win =
	{
		-- Functions added to this table will be called on level win, before running any of the winning-related code.
	},
	level_win_after =
	{
		-- Functions added to this table will be called on level win, after running the winning-related code.
	},
	level_restart =
	{
		-- Functions added to this table will be called when the player restarts a level.
	},
	rule_update =
	{
		-- Functions added to this table will be called when rules are updated. Extra data: {is_this_a_repeated_update [false = no, true = yes]} <-- the extra variable is true e.g. when Word-related rules require the rules to be refreshed multiple times in a row.
	},
	rule_baserules =
	{
		-- Functions added to this table will be called as the game adds the base rules into the rule list (i.e. ones that aren't visible in the rule list). You can use addbaserule(word 1, word 2, word 3) here to add your own base rules.
	},
	rule_update_after =
	{
		-- Functions added to this table will be called after rules have been updated. Extra data: {is_this_a_repeated_update [false = no, true = yes]} <-- the extra variable is true e.g. when Word-related rules require the rules to be refreshed multiple times in a row.
	},
	command_given =
	{
		-- Functions added to this table will be called when a player command starts resolving. Extra data: {command, player_id}
	},
	movement_take =
	{
		-- Functions added to this table will be called when a group of moving objects are being iterated through. Extra data: {moving_objects, take [i.e. which set of moving objects is currently being handled]}
	},
	movement_end =
	{
		-- Functions added to this table will be called when the movement calculations have been done during a turn.
	},
	block =
	{
		-- Functions added to this table will be called when the main chunk of rule effects (e.g. Sink, Hot/Melt, Make) are being handled during a turn.
	},
	block_level =
	{
		-- Functions added to this table will be called when the rule effects specific to the entire level (e.g. Level Is Melt) are being handled during a turn.
	},
	turn_auto =
	{
		-- Functions added to this table will be called when a turn starts resolving due to 'Level Is Auto'. Extra data: {player_1_direction, player_2_direction, is_a_player_moving [false = no, true = yes]}
	},
	turn_end =
	{
		-- Functions added to this table will be called when a turn ends. Extra data: {player_found [0 = no, 1 = yes]}
	},
	always =
	{
		-- Functions added to this table will be called every frame. This can get quite slow, so be aware of that! Extra data: {time_from_game_start}
	},
	effect_once =
	{
		-- Functions added to this table will be called once at the end of every turn.
	},
	effect_always =
	{
		-- Functions added to this table will be called every frame when you're playing a level.
	},
	undoed =
	{
		-- Functions added to this table will be called when the player does an undo input.
	},
	undoed_after =
	{
		-- Functions added to this table will be called after undo has taken effect.
	},
	levelpack_end =
	{
		-- Functions added to this table will be called when the player does the Level Is End ending in a levelpack. Note that if any functions are run here, the normal victory effects won't be displayed.
	},
	levelpack_done =
	{
		-- Functions added to this table will be called when the player does the All Is Done ending in a levelpack. Note that if any functions are run here, the normal victory effects won't be displayed.
	},
	text_input_ok =
	{
		-- Functions added to this table will be called when the user has input text in the text input dialogue and pressed OK. Extra data: {sanitized_text}
	},
	mouse_click =
	{
		-- Functions added to this table will be called when the user clicks a mouse button. Extra data: {button id} - Left mouse = 1, Right mouse = 2, Middle mouse = 3
		-- NOTE: this modhook is available even when not playing a level, as long as your mod is loaded. To avoid issues, you can check that editor.strings[MENU] == "ingame" to make sure a function only takes effect while in-game.
	},
	keyboard_input =
	{
		-- Functions added to this table will be called when the user presses a button on their keyboard. NOTE: certain buttons might be detected wonkily due to them being used for other effects (e.g. Escape). Extra data: {button id}
		-- NOTE: this modhook is available even when not playing a level, as long as your mod is loaded. To avoid issues, you can check that editor.strings[MENU] == "ingame" to make sure a function only takes effect while in-game.
	},
	keyboard_hold =
	{
		-- Functions added to this table will be called when the user holds a button on their keyboard. NOTE: certain buttons might be detected wonkily due to them being used for other effects (e.g. Escape). Extra data: {button id}
		-- NOTE: this modhook is available even when not playing a level, as long as your mod is loaded. To avoid issues, you can check that editor.strings[MENU] == "ingame" to make sure a function only takes effect while in-game.
		--[[
		If you wish to make a function here respect the in-game input delay, have the following at the start of the function:
			if editor.strings[MENU] == "ingame" and generaldata.values[IGNORE] == 0 and generaldata.values[DELAY_INGAME] == 0 and generaldata.values[UPDATE] == 0 then
				generaldata.values[DELAY_INGAME] = generaldata3.values[INPUTDELAY]
		]]--
	}
}

function do_mod_hook(name,extra_)
	local extra = extra_ or {}
	local mods_run = false
	
	if (mod_hook_functions[name] ~= nil) then
		for i,v in pairs(mod_hook_functions[name]) do
			if (type(v) == "function") then
				v(extra)
				mods_run = true
			end
		end
	end
	
	return mods_run
end

-- This function gets called when a button is clicked; if there's an entry in buttonclick_list for the ID of that button, the function at that entry will be run.
buttonclick_list = {}
function buttonclicked(name,unitid)
	if (string.len(name) > 0) and (buttonclick_list[name] ~= nil) then
		buttonclick_list[name](unitid)
	end
end

-- This function gets called when a slider is adjusted; if there's an entry in slider_list for the ID of that button, the function at that entry will be run. The function also receives information about the current value of the slider, as well as the change between its current value and previous value (note that the function will be constantly called when held, with a change of 0)
slider_list = {}
function slidermoved(name,unitid,value,change)
	if (string.len(name) > 0) and (slider_list[name] ~= nil) then
		slider_list[name](unitid,value,change)
	end
end

-- This function gets called if an undo event happens that isn't any of the ones in the base game; if undo_list has an entry corresponding to the id of the undo event, that entry gets called instead.
undo_list = {}
function undocall(id,data)
	if (#id > 0) and (undo_list[id] ~= nil) then
		undo_list[id](id,data)
	end
end

-- This function gets called when a special object is being handled. Use MF_parsestring() or MF_parsestring_equals() to go through the information in the text variable. The reason why there are two separate id variables is because some special object types use = instead of , as the delimiter for their data (yes, it's silly). Insert functions in the special_customtypes table to run them when the relevant special object type is being handled.
special_customtypes = {}
function handlespecial_custom(unitid,text,id_comma,id_equals,x,y)
	local data = special_customtypes[id_comma] or special_customtypes[id_equals]
	
	if (data ~= nil) then
		data(unitid,text)
	end
end

-- These functions can be used to trigger a transition between levels
function leveltransition_change(levelid,levelnumber,leveltype,resetleveltree)
	generaldata.values[TRANSITIONREASON] = 9
	generaldata.values[IGNORE] = 1
	generaldata.values[WINTIMER] = 0
	generaldata3.values[STOPTRANSITION] = 1
	MF_store("save",generaldata.strings[WORLD],"Previous",generaldata.strings[CURRLEVEL])
	changelevel(levelid,levelnumber,leveltypee,resetleveltree)
	MF_loop("transition",1)
end

function leveltransition_sublevel(levelid,levelnumber,leveltype)
	generaldata.values[TRANSITIONREASON] = 9
	generaldata.values[IGNORE] = 1
	generaldata.values[WINTIMER] = 0
	generaldata3.values[STOPTRANSITION] = 1
	MF_store("save",generaldata.strings[WORLD],"Previous",generaldata.strings[CURRLEVEL])
	sublevel(levelid,levelnumber,leveltypee)
	MF_loop("transition",1)
end

function leveltransition_leave()
	generaldata.values[TRANSITIONREASON] = 1
	generaldata.values[IGNORE] = 1
	generaldata.values[WINTIMER] = 0
	generaldata3.values[STOPTRANSITION] = 0
	uplevel(levelid,levelnumber,leveltypee)
	MF_loop("transition",1)
end

-- Setup functions

function setupmods_global()
	local files = MF_filelist("Data/Lua/","*.lua")
	
	table.sort(files)
	
	for i,file in ipairs(files) do
		print("Added custom lua file " .. file)
		dofile("Data/Lua/" .. file)
	end
end

function setupmods_levelpack()
	local world = generaldata.strings[WORLD]
	local files = MF_filelist("Data/Worlds/" .. world .. "/Lua/","*.lua")
	
	--MF_alert(world .. ": " .. tostring(#files))
	
	table.sort(files)
	
	for i,file in ipairs(files) do
		print("Added custom levelpack (" .. world .. ") lua file " .. file)
		dofile("Data/Worlds/" .. world .. "/Lua/" .. file)
	end
	
	modsinuse = true
end