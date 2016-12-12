'use strict';

const { Promise } = require('thenfail');

Object.assign(
    exports,
    require('./commands'),
    require('./device'),
    require('./app')
);

function preflight() {
    return Promise.then(() => {
        return {
            ruffVersion: '1.2.0',
            authorization: null
        };
    });
}

exports.preflight = preflight;
