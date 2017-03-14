'use strict';

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const chalk = require('chalk');
const tmp = require('tmp');
const { Promise } = require('thenfail');

const { flash } = require('../lib/lm4flash');

const ORIGIN = 500 * 1024;

const ruffCompiler = 'ruff-compiler';

exports.deploy = function (rap, program, trace) {
    program
        .usage('[options...]')
        .option('--source', 'deploy source code directly without pre-compilation')
        //.option('--force', 'force deployment even if a claim claims incompatable engine or board')
        .option('--package [path]', 'create the deployment package for lm4flash')
        .option('--ota', 'specify OTA usage for packaging')
        .option('--align <bytes>', 'specify alignment for packaging')
        .option('--address <address>', 'create the deployment package with absolute addressing')
        .option('--layout <path>', 'use custom layout file');

    trace.push(action);
};

function action(rap, program) {
    let toCompile = !program.source;
    let ota = program.ota;

    // lm4flash requires 4K, but OTA doesn't
    let alignment = Number.parseInt(program.align) || 4 * 1024;
    alignment = Math.floor(alignment / 8) * 8;

    // disable absolute addressing by default
    program.address = program.address || '-1';
    let origin = Number.parseInt(program.address) || ORIGIN;

    // figure out APP path
    let appPath = program.package || null;
    if (typeof appPath === 'boolean') {
        appPath = require(path.join(process.cwd(), 'package.json')).name;
    }
    if (appPath && !/\.bin$/i.test(appPath)) {
        appPath += '.bin';
    }

    rap
        .getDeploymentManifest()
        .then(manifest => {
            if (appPath) {
                // create package only
                return new Promise((resolve, reject) => {
                    try {
                        let appBuffer = generateApp(manifest, toCompile, origin, alignment, ota);
                        fs.writeFileSync(appPath, appBuffer);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }).then(() => {
                    console.log(`Package created at "${appPath}"`);
                });
            } else {
                // create package and deploy it
                let appPath = tmp.tmpNameSync();
                let appBuffer = generateApp(manifest, toCompile, origin, alignment);
                fs.writeFileSync(appPath, appBuffer);

                if (origin < 0) {
                    origin = 1024*1024 - appBuffer.length;
                }

                let cp = flash({
                    binary: appPath,
                    address: origin
                });

                return Promise.for(cp);
            }
        });
}

function generateApp(manifest, toCompile, origin, alignment, ota) {
    const deployment = (origin < 0) ? require('../lib/deployment') : require('../lib/deploymentAbsolute');

    let compilerCmd = findCommand(ruffCompiler);
    if (!compilerCmd) {
        toCompile = false;
        console.log(chalk.yellow(`Could not find "${ruffCompiler}" in $PATH, fallback to source code.`));
    }

    let rofsManifest = [];
    let modsManifest = [
        {
            name: 'dht11',
            objects: [

            ]
        }
    ];

    let modMap = Object.create(null);

    for (let pathInfo of manifest) {
        let { name, source, sourceText, content } = pathInfo;

        let extName = path.extname(name);
        switch (extName) {
            case '.so': {
                let searchName = name;

                let lastBaseName;
                let baseName;

                do {
                    lastBaseName = baseName;
                    searchName = path.dirname(searchName);
                    baseName = path.basename(searchName);
                } while (lastBaseName !== 'ruff_modules');

                let moduleName = lastBaseName;

                if (moduleName in modMap) {
                    modMap[moduleName].objects.push(source || content);
                } else {
                    let mod = {
                        name: moduleName,
                        objects: [source || content]
                    };

                    modMap[moduleName] = mod;

                    modsManifest.push(mod);
                }

                break;
            }

            case '.js': {
                let name = pathInfo.name;
                let content = pathInfo.content || pathInfo.sourceText || fs.readFileSync(pathInfo.source);
                if (toCompile) {
                    let patched = `(function(){return function(exports,require,module,__filename,__dirname){${content}\n}})();`;
                    content = runCompiler(compilerCmd, name, patched);
                }
                rofsManifest.push({ name, content });
                break;
            }

            case '.json': {
                let name = pathInfo.name;
                let content = pathInfo.content || pathInfo.sourceText || fs.readFileSync(pathInfo.source);
                if (toCompile) {
                    let patched = `(function(){return ${content.toString().trim()};})();`;
                    content = runCompiler(compilerCmd, name, patched);
                }
                rofsManifest.push({ name, content });
                break;
            }

            default: {
                rofsManifest.push(pathInfo);
                break;
            }
        }
    }

    return deployment.mkapp(origin, modsManifest, rofsManifest, alignment, ota);
}

function runCompiler(compileCmd, srcName, srcContent) {
    let result = spawnSync(compileCmd, [srcName], {
        input: srcContent
    });

    if (result.error) {
        console.log(`Unable to run ${ruffCompiler}`);
        throw result.error;
    }

    if (result.status !== 0) {
        let msg = result.stdout.toString();
        throw new Error(msg);
    }

    return result.stdout;
}

function findCommand(cmd) {
    const which = require('which');
    try {
        return which.sync(cmd);
    } catch (e) {
        return '';
    }
}
