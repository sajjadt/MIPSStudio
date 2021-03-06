// Returns an interpreter instance
var Runtime = (function () {
    // CONSTANTS
    var cycle_limit = 1000000; // Max number of instructions to run

    // RETURNS A NEW INSTANCE OF AN INTERPRETER
    var create = function (data, text, io) {
        // Counts how many instructions have been executed
        var cycles = 0;

        // Have we exited?
        var has_exited = false;

        // Do we have an error?
        var error = null;

        // Output for syscalls
        var output = "";

        // A reference to the current raw instruction (or null)
        // Useful for debugging and error messages.
        var current_inst = null;

        // The registers
        var registers = {
            "PC": 0,
            "HI": 0,
            "LO": 0,
            "$0": 0,
            "$1": 0,
            "$2": 0,
            "$3": 0,
            "$4": 0,
            "$5": 0,
            "$6": 0,
            "$7": 0,
            "$8": 0,
            "$9": 0,
            "$10": 0,
            "$11": 0,
            "$12": 0,
            "$13": 0,
            "$14": 0,
            "$15": 0,
            "$16": 0,
            "$17": 0,
            "$18": 0,
            "$19": 0,
            "$20": 0,
            "$21": 0,
            "$22": 0,
            "$23": 0,
            "$24": 0,
            "$25": 0,
            "$26": 0,
            "$27": 0,
            "$28": 0,
            "$29": 0,
            "$30": 0,
            "$31": 0
        };

        // The stack. Will be created by reset().
        var stack = null;

        // The data segment. Will be created by reset from 'data'.
        var data_segment = null;

        // Safely writes a value to a register
        var write_register = function (reg, value) {
            registers[reg] = Utils.Math.to_unsigned(value, 32);
        };

        // An array of line numbers (in original text) to break on
        var breakpoints = [];
        var breaked = false;

        // Adds/removes a breakpoint to/from the list appropriately
        var toggle_breakpoint = function (point) {
            var index = breakpoints.indexOf(point);
            if (index === -1) {
                breakpoints.push(point);
            } else {
                breakpoints.splice(index, 1);
            }

            return get_state();
        };

        // Mini-program that executes a single instruction.
        var programs = {
            "lui": function (args) {
                var dest = args[0];
                var imm = Utils.Math.to_unsigned(args[1], 16);

                write_register(dest, imm << 16);

                return { set_PC: false };
            },

            "ori": function (args) {
                var dest = args[0];
                var reg = args[1];
                var imm = Utils.Math.to_unsigned(args[2], 16);

                write_register(dest, registers[reg] | imm);

                return { set_PC: false };
            },

            "addi": function (args) {
                var dest = args[0];
                var reg = args[1];
                var imm = args[2];

                var signed_reg = Utils.Math.to_signed(registers[reg], 32);
                var signed_imm = Utils.Math.to_signed(imm, 16);
                var sum = signed_reg + signed_imm;

                // TODO: Throw an exception on overflow

                write_register(dest, sum);

                return { set_PC: false };
            },

            "addiu": function (args) {
                // Just do addi for now
                return programs.addi(args);
            },

            "add": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);
                var sum = signed_reg1 + signed_reg2;

                // TODO: Throw an exception on overflow

                write_register(dest, sum);

                return { set_PC: false };
            },

            "addu": function (args) {
                // Just do an add for now
                return programs.add(args);
            },

            "sub": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);
                var sub = signed_reg1 - signed_reg2;

                // TODO: Throw an exception on overflow

                write_register(dest, sub);

                return { set_PC: false };
            },

            "subu": function (args) {
                // Just do a sub for now
                return programs.sub(args);
            },

            "mult": function (args) {
                var reg1 = args[0];
                var reg2 = args[1];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);

                var product = signed_reg1 * signed_reg2;
                var hi = 0; // FOR NOW
                // TODO: Figure out how to get the actual 'hi' value in javascript.
                var lo = product & 0xFFFFFFFF;

                write_register("HI", hi);
                write_register("LO", lo);

                return { set_PC: false };
            },

            "mflo": function (args) {
                var dest = args[0];

                write_register(dest, registers["LO"]);

                return { set_PC: false };
            },

            "mfhi": function (args) {
                var dest = args[0];

                write_register(dest, registers["HI"]);

                return { set_PC: false };
            },

            "div": function (args) {
                var reg1 = args[0];
                var reg2 = args[1];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);

                if (signed_reg2 === 0) {
                    // FAIL
                    throw Utils.get_error(18, [current_inst.line]);
                }

                var hi = signed_reg1 % signed_reg2;
                var div = signed_reg1 / signed_reg2;
                var lo = div >= 0 ? Math.floor(div) : Math.ceil(div);

                write_register("HI", hi);
                write_register("LO", lo);

                return { set_PC: false };
            },

            "and": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                write_register(dest, registers[reg1] & registers[reg2]);

                return { set_PC: false };
            },

            "or": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                write_register(dest, registers[reg1] | registers[reg2]);

                return { set_PC: false };
            },

            "andi": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var imm = args[2];
                var unsigned_imm = Utils.Math.to_unsigned(imm, 16);

                write_register(dest, registers[reg1] & unsigned_imm);

                return { set_PC: false };
            },

            "xor": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                write_register(dest, registers[reg1] ^ registers[reg2]);

                return { set_PC: false };
            },

            "nor": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                write_register(dest, ~(registers[reg1] | registers[reg2]));

                return { set_PC: false };
            },

            "slt": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);

                write_register(dest, (signed_reg1 < signed_reg2) ? 1 : 0);

                return { set_PC: false };
            },

            "slti": function (args) {
                var dest = args[0];
                var reg = args[1];
                var imm = args[2];

                var signed_reg = Utils.Math.to_signed(registers[reg], 32);
                var signed_imm = Utils.Math.to_signed(imm, 16);

                write_register(dest, (signed_reg < signed_imm) ? 1 : 0);

                return { set_PC: false };
            },

            "sll": function (args) {
                var dest = args[0];
                var reg = args[1];
                var imm = args[2];

                var unsigned_reg = Utils.Math.to_unsigned(registers[reg], 32);
                var unsigned_imm = Utils.Math.to_unsigned(imm, 16);

                write_register(dest, unsigned_reg << unsigned_imm);

                return { set_PC: false };
            },

            "srl": function (args) {
                var dest = args[0];
                var reg = args[1];
                var imm = args[2];

                var unsigned_reg = Utils.Math.to_unsigned(registers[reg], 32);
                var unsigned_imm = Utils.Math.to_unsigned(imm, 16);

                write_register(dest, unsigned_reg >>> unsigned_imm);

                return { set_PC: false };
            },

            "sllv": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                var unsigned_reg1 = Utils.Math.to_unsigned(registers[reg1], 32);
                var unsigned_reg2 = Utils.Math.to_unsigned(registers[reg2], 32);

                write_register(dest, unsigned_reg1 << unsigned_reg2);

                return { set_PC: false };
            },

            "srlv": function (args) {
                var dest = args[0];
                var reg1 = args[1];
                var reg2 = args[2];

                var unsigned_reg1 = Utils.Math.to_unsigned(registers[reg1], 32);
                var unsigned_reg2 = Utils.Math.to_unsigned(registers[reg2], 32);

                write_register(dest, unsigned_reg1 >>> unsigned_reg2);

                return { set_PC: false };
            },

            "jr": function (args) {
                return { set_PC: registers[args[0]] };
            },

            "j": function (args) {
                var val = args[0];
                var addr = (registers["PC"] & 0xF0000000) | (val << 2);

                return { set_PC: addr };
            },

            "jal": function (args) {
                var val = args[0];
                var addr = (registers["PC"] & 0xF0000000) | (val << 2);

                write_register("$31", registers["PC"] + 4);

                return { set_PC: addr };
            },

            "sw": function (args, bits) {
                bits = bits || 4;

                var src = args[0];
                var offset = args[1];
                var reg = args[2];

                src = Utils.Math.to_unsigned(registers[src], 32);
                reg = Utils.Math.to_unsigned(registers[reg], 32);
                offset = Utils.Math.to_signed(offset, 16);

                Memory.write(src, offset + reg, bits);

                return { set_PC: false };
            },

            "sh": function (args) {
                return programs.sw(args, 2);
            },

            "sb": function (args) {
                return programs.sw(args, 1);
            },

            "lw": function (args) {
                var dest = args[0];
                var offset = args[1];
                var reg = args[2];

                reg = Utils.Math.to_unsigned(registers[reg], 32);
                offset = Utils.Math.to_signed(offset, 16);

                var value = Memory.read(offset + reg, 4);
                write_register(dest, value);

                return { set_PC: false };
            },

            "lh": function (args) {
                var dest = args[0];
                var offset = args[1];
                var reg = args[2];

                reg = Utils.Math.to_unsigned(registers[reg], 32);
                offset = Utils.Math.to_signed(offset, 16);

                var value = Memory.read(offset + reg, 2);
                value = Utils.Math.to_signed(value, 16); // Sign extend
                write_register(dest, value);

                return { set_PC: false };
            },

            "lhu": function (args) {
                var dest = args[0];
                var offset = args[1];
                var reg = args[2];

                reg = Utils.Math.to_unsigned(registers[reg], 32);
                offset = Utils.Math.to_signed(offset, 16);

                var value = Memory.read(offset + reg, 2);
                write_register(dest, value);

                return { set_PC: false };
            },

            "lb": function (args) {
                var dest = args[0];
                var offset = args[1];
                var reg = args[2];

                reg = Utils.Math.to_unsigned(registers[reg], 32);
                offset = Utils.Math.to_signed(offset, 16);

                var value = Memory.read(offset + reg, 1);
                value = Utils.Math.to_signed(value, 8); // Sign extend
                write_register(dest, value);

                return { set_PC: false };
            },

            "lbu": function (args) {
                var dest = args[0];
                var offset = args[1];
                var reg = args[2];

                reg = Utils.Math.to_unsigned(registers[reg], 32);
                offset = Utils.Math.to_signed(offset, 16);

                var value = Memory.read(offset + reg, 1);
                write_register(dest, value);

                return { set_PC: false };
            },

            "beq": function (args) {
                var reg1 = args[0];
                var reg2 = args[1];
                var imm = args[2];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);
                var signed_imm = Utils.Math.to_signed(imm, 16);

                if (signed_reg1 === signed_reg2) {
                    return { set_PC: registers["PC"] + 4 + (signed_imm * 4) }
                } else {
                    return { set_PC: false };
                }
            },

            "bne": function (args) {
                var reg1 = args[0];
                var reg2 = args[1];
                var imm = args[2];

                var signed_reg1 = Utils.Math.to_signed(registers[reg1], 32);
                var signed_reg2 = Utils.Math.to_signed(registers[reg2], 32);
                var signed_imm = Utils.Math.to_signed(imm, 16);

                if (signed_reg1 !== signed_reg2) {
                    return { set_PC: registers["PC"] + 4 + (signed_imm * 4) }
                } else {
                    return { set_PC: false };
                }
            },

            "syscall": function (args) {
                var v0 = registers['$2'];

                if (v0 === 1) {
                    // Print int from $a0
                    var int = Utils.Math.to_signed(registers["$4"], 32);
                    output += int.toString();
                }

                if (v0 === 4) {
                    // Print string at address $a0
                    var addr = Utils.Math.to_unsigned(registers["$4"], 32);

                    var tries = 0;
                    while (tries < 1000) {
                        var byte = Memory.read(addr, 1);
                        var char = String.fromCharCode(byte);
                        if (char === "\0") {
                            break;
                        }

                        output += char;

                        addr += 1;
                        tries += 1;
                    }
                }

                if (v0 === 10) {
                    // exit
                    has_exited = true;
                }

                if (v0 === 11) {
                    // Print a character from $a0's low byte
                    byte = Utils.Math.to_unsigned(registers["$4"], 32) & 0x000000FF;
                    char = String.fromCharCode(byte);

                    output += char;
                }

                return { set_PC: false };
            }
        };

        // Executes a single instruction
        var run_instruction = function (to_execute) {
            // Update current_inst
            current_inst = to_execute.raw;

            // Make sure the isntruction is recognized
            // (If the parser is working, this should never occur.)
            if (!programs[to_execute.inst]) {
                // FAIL
                throw Utils.get_error(15, [to_execute.raw.text, to_execute.raw.line]);
            }

            // Do the deed!
            return programs[to_execute.inst](to_execute.args);
        };

        // Read/writes to memory
        var Memory = {
            read: function (addr, bytes) {
                // Should this be done via IO?
                if (io) {
                    var hex_addr = Utils.Math.to_hex(addr);
                    var funct = io.mem_map(hex_addr);
                    if (funct) {
                        return funct(true, data_segment, null);
                    }
                }

                // Do we have a memory?
                // (get_mem throws an exception on failure)
                var memory = Memory.get_mem(addr);

                // Are we aligned?
                if (addr % bytes !== 0) {
                    // FAIL
                    throw Utils.get_error(21, [current_inst.line]);
                }

                // Do the deed
                var result = 0;
                for (var i = bytes - 1; i >= 0; i--) {
                    var hex = Utils.Math.to_hex(addr + i);
                    var byte = Utils.get(memory, hex);

                    if (byte === null) {
                        // FAIL
                        throw Utils.get_error(19, [current_inst.line]);
                    }

                    result = (result << 8) | byte;
                }

                // Return the result
                return result;
            },

            write: function (value, addr, bytes) {
                // Should this be done via IO?
                if (io) {
                    var hex_addr = Utils.Math.to_hex(addr);
                    var funct = io.mem_map(hex_addr);
                    if (funct) {
                        return funct(false, data_segment, value);
                    }
                }

                // Do we have a memory?
                // (get_mem throws an exception on failure)
                var memory = Memory.get_mem(addr);

                // Are we aligned?
                if (addr % bytes !== 0) {
                    // FAIL
                    throw Utils.get_error(21, [current_inst.line]);
                }

                // Do the deed
                for (var i = 0; i < bytes; i++) {
                    var to_write = value & 0xff;
                    value = value >>> 8;
                    var hex = Utils.Math.to_hex(addr + i);

                    // Watch for seg fault
                    var byte = Utils.get(memory, hex);
                    if (byte === null) {
                        // FAIL
                        throw Utils.get_error(19, [current_inst.line]);
                    }

                    memory[hex] = to_write;
                }
            },

            // Data, Stack, Overflow, Segfault?
            get_mem: function (addr) {
                // Are we within the data segment?
                // If so, did we seg fault?
                if (addr >= DataParser.base_address && addr <= DataParser.max_address) {
                    var mem = data_segment;
                    var hex = Utils.Math.to_hex(addr);

                    if (Utils.get(mem, hex) === null) {
                        // FAIL
                        throw Utils.get_error(19, [current_inst.line]);
                    }

                    return mem;
                }

                // Are we within the stack segment?
                if (addr >= DataParser.base_stack && addr <= DataParser.max_stack) {
                    return stack;
                }

                // Have we likely stack overflowed?
                if (addr > DataParser.base_stack - 40) {
                    // FAIL
                    throw Utils.get_error(20, [current_inst.line]);
                }

                // If we reach here, we seg faulted. :(
                throw Utils.get_error(19, [current_inst.line]);
            }
        };

        // Runs a single cycle
        var run_cycle = function () {
            if (has_exited) {
                // Only run a cycle if we have not exited.
                return;
            }

            try {
                var PC = registers["PC"];

                // Is the current PC an exit address?
                if (PC === TextParser.base_address - 4 || PC === text.end_addr) {
                    has_exited = true;
                    return;
                }

                // Are we within the cycle limit?
                if (cycles >= cycle_limit) {
                    // FAIL
                    throw Utils.get_error(13, []);
                }

                // Attempt to load the instruction
                var PC_hex = Utils.Math.to_hex(PC);
                var inst = Utils.get(text.segment, PC_hex);
                if (!inst) {
                    // FAIL
                    throw Utils.get_error(14, [PC_hex]);
                }

                // Run the instruction
                var inst_result = run_instruction(inst);

                // Update PC and cycles
                cycles++;

                if (inst_result.set_PC) {
                    registers["PC"] = inst_result.set_PC;
                } else {
                    registers["PC"] = registers["PC"] + 4;
                }

                // Update the io module
                if (io) {
                    io.update();
                }
            } catch (e) {
                // Set the error object and note that we exited
                error = e;
                has_exited = true;
            }
        };

        // Returns true iff a breakpoint has been reached
        var has_hit_breakpoint = function () {
            var PC_hex = Utils.Math.to_hex(registers["PC"]);
            var inst = Utils.get(text.segment, PC_hex);

            if (breaked) {
                // Allow the program to continue after hitting a breakpoint
                breaked = false;
                debugger;
                return false;
            }

            if (inst) {
                var line = inst.raw.line;

                if (breakpoints.indexOf(line) !== -1 && PC_hex == Utils.Math.to_hex(inst.raw.base)) {
                    breaked = true;
                    return true;
                }
            }

            return false;
        };
        
        // Runs n instructions
        var run_n = function (n) {
            if (n < 1) {
                return get_state();
            }

            for (var i = 0; i < n; i++) {
                var should_break = has_hit_breakpoint() && n > 1;
                if (!should_break) {
                    // The n>1 condition is not accounted for in has_hit_breakpoint
                    breaked = false;
                }
                if (has_exited || should_break) {
                    break;
                }

                run_cycle();
            }

            return get_state();
        };

        // Runs until end or error
        var run_to_end = function () {
            while (!has_exited && !has_hit_breakpoint()) {
                run_cycle();
            }

            return get_state();
        };

        // Resets the machine
        var reset = function () {
            // Set all registers to zero
            registers["PC"] = 0;
            registers["HI"] = 0;
            registers["LO"] = 0;
            for (var i = 0; i < 32; i++) {
                registers["$" + i] = 0;
            }

            // Reset the data segment as well
            data_segment = data.segment();

            // Initalize $ra to a special address
            registers["$31"] = TextParser.base_address - 4;

            //  Create a stack segment, point $sp to the top.
            stack = DataParser.create_stack();
            registers["$29"] = DataParser.max_stack;

            // Reset the error
            error = null;

            // Reset the output
            output = "";

            // Reset the current_inst
            current_inst = null;

            // Reset the cycle count
            cycles = 0;

            // Match PC to the main label
            registers["PC"] = text.labels["main"];

            // We have not exited
            has_exited = false;

            // Remove any breakpoints
            breakpoints = [];
            breaked = false;

            // Reset the io
            if (io) {
                io.reset();
            }

            // Return out the clean state
            return get_state();
        };

        // Returns the current state of the machine (registers, exited, cycle count)
        var get_state = function () {
            // Deep copy registers (helpful?)
            var ret_registers = {};
            ret_registers["PC"] = registers["PC"];
            ret_registers["HI"] = registers["HI"];
            ret_registers["LO"] = registers["LO"];
            for (var i = 0; i < 32; i++) {
                ret_registers["$" + i] = registers["$" + i];
            }

            return {
                registers: ret_registers,
                has_exited: has_exited,
                cycles: cycles,
                data: data_segment,
                stack: stack,
                error: error,
                output: output,
                current_inst: current_inst,
                breakpoints: breakpoints,
                breaked: breaked,
                io: io
            };
        };

        // Run the reset function once to initalize.
        reset();

        // Return out the interface
        return {
            run_n: run_n,
            run_to_end: run_to_end,
            get_state: get_state,
            reset: reset,
            toggle_breakpoint: toggle_breakpoint
        };
    };

    // Return out the interface
    return {
        create: create
    };
})();