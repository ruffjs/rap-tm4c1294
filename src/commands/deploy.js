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
        .option('--package-compact [path]', 'create the compact deployment package for OTA')
        .option('--address <address>', 'create the deployment package with a specific flash address')
        .option('--layout <path>', 'use custom layout file');

    trace.push(action);
};

function action(rap, program) {
    let toCompile = !program.source;
    let origin = Number.parseInt(program.address, 10) || ORIGIN;

    // figure out APP path
    let appPath = program.package || program.packageCompact || null;
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
                let isCompact = !!program.packageCompact;
                return new Promise((resolve, reject) => {
                    try {
                        let appBuffer = generateApp(manifest, toCompile, origin, isCompact);
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
                let appBuffer = generateApp(manifest, toCompile, origin, false);
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

function generateApp(manifest, toCompile, origin, isCompact) {
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
        let { name, source, content } = pathInfo;

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
                if (toCompile) {
                    let orig = pathInfo.content ? pathInfo.content : fs.readFileSync(pathInfo.source);
                    let content = `(function(){return function(exports,require,module,__filename,__dirname){${orig}\n}})();`;
                    let compiled = runCompiler(compilerCmd, name, content);
                    delete pathInfo.source;
                    pathInfo.content = compiled;
                }
                rofsManifest.push(pathInfo);
                break;
            }

            case '.json': {
                if (toCompile) {
                    let orig = pathInfo.content ? pathInfo.content : fs.readFileSync(pathInfo.source);
                    let content = `(function(){return ${orig.toString().trim()};})();`;
                    let compiled = runCompiler(compilerCmd, name, content);
                    delete pathInfo.source;
                    pathInfo.content = compiled;
                }
                rofsManifest.push(pathInfo);
                break;
            }

            default: {
                rofsManifest.push(pathInfo);
                break;
            }
        }
    }

    return deployment.mkapp(origin, modsManifest, rofsManifest, isCompact);
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
