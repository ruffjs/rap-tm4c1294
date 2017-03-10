'use strict';

exports.system = function (rap, program, trace) {
    program
        .command('upgrade <firmware-binary-file>')
        .description('upgrade ruff firmware')
        .option('-E, --erase', 'erase entire flash')
        .action((binPath, options) => {
            trace.push('upgrade');

            const fs = require('fs');
            const { Promise } = require('thenfail');
            const { flash } = require('../lib/lm4flash');

            if (!fs.existsSync(binPath)) {
                console.error('The binary file specified does not exist.');
                process.exit(1);
            }

            let cp = flash({
                binary: binPath,
                address: 0,
                erase: options.erase
            });

            return Promise.for(cp);
        });
};
