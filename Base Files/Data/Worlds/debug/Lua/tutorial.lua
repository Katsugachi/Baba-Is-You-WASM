-- Here we add two new objects to the object list

table.insert(editor_objlist_order, "tuto")
table.insert(editor_objlist_order, "text_tuto")

-- This defines the exact data for them (note that since the sprites are specific to this levelpack, sprite_in_root must be false!)

editor_objlist["tuto"] = 
{
	name = "tuto",
	sprite_in_root = false,
	unittype = "object",
	tags = {"abstract"},
	tiling = -1,
	type = 0,
	layer = 20,
	colour = {0, 3},
}

editor_objlist["text_tuto"] = 
{
	name = "text_tuto",
	sprite_in_root = false,
	unittype = "text",
	tags = {"text","abstract"},
	tiling = -1,
	type = 0,
	layer = 20,
	colour = {0, 2},
	colour_active = {0, 3},
}

-- After adding new objects to the list, formatobjlist() must be run to setup everything correctly.

formatobjlist()

-- Here we load a sound to memory so that it can be played during runtime.

MF_loadsound("example")

-- To demonstrate how modsupport.lua works, here we add a function that displays a simple message and plays a custom sound every time a level starts.

table.insert(mod_hook_functions["level_start"],
	function()
		timedmessage("Starting a new level!")
		MF_playsound("example")
	end
)

--[[
Use the following to set up a custom completion icon:
In world_data.txt, set up the following:

[completion_icons]
count=1
1_flag=test
1_file=testicon

This means that there's one custom completion icon (count=1), and that icon looks for the flag 'test' in a player's savefile and loads the file 'testicon.png' if the flag is set.

After this, running this command would grant the player the icon:
MF_store("save",generaldata.strings[WORLD],"test","1")
]]--

-- Example for triggering a level transition by pressing M
table.insert(mod_hook_functions["keyboard_input"],
	function(key)
		if (editor.strings[MENU] == "ingame") and (generaldata.values[MODE] == 0) and (key[1] == "M") then
			leveltransition_change("3level",1,0)
		end
	end
)