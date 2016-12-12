'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const { Promise } = require('thenfail');

let commandMap = Object.create({});

commandMap.system = function (program, trace) {
    program
        .command('upgrade <firmware-binary-file>')
        .description('upgrade ruff firmware')
        .action(binPath => {
            trace.push('upgrade');

            if (!fs.existsSync(binPath)) {
                console.error('The binary file specified does not exist.');
                process.exit(1);
            }

            let flash = spawn('lm4flash', [
                binPath
            ], {
                stdio: 'inherit'
            });
            return Promise.for(flash);
        });
};

function setupCommands(program, commandName, trace) {
    commandMap[commandName](program, trace);
}

exports.setupCommands = setupCommands;
