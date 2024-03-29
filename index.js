/**
 * @param url, string, resource destination url to make request to, the fetch request will be delegated either to window.fetch(when use in browser) or npm module node-fetch(when use in node server side).
 * @param init, object, can have properties in 'init' parameter of window.fetch api(https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters)
 * or in 'options' parameter of node-fetch library (https://www.npmjs.com/package/node-fetch#options)
 * beside those init/options settings from window.fetch or node-fetch, it has two MANDATORY settings: 'init.timeout' to time-box a request and 'init.maxRequests' to limit the total number of requests to attempt
 * @param optLogger, optional function, will be called with a single string parameter to give a hint when making request.
 *
 * @return a promise resolved with a positive result or a rejected promise if eventually failed
 */
function robustHttpFetchAsPromise(url, init, optLogger) {
    return new Promise((resolve => {
        robustHttpFetch(url, init, resolve, optLogger);
    }));
}

function robustHttpFetch(url, init, callback, optLogger) {
    checkArgs(...arguments);
    const {timeout, maxRequests} = init;
    const logger = getLogger(optLogger);
    const worker = requestWorker(url, init);

    // container holding scheduled timer, entry is a 2-values array, 1st is SN(SeqNumber) of scheduled request, 2nd is timer ID;
    const queuedTimers = [];

    const doFetch = (cb, sn, startTime) => {
        logger(`#${sn} request about to fire`);
        let result;
        try {
            const promise = worker();
            result = Promise.resolve(promise);
        } catch (e) {
            result = Promise.reject(e.message);
        }
        cb(result, sn, startTime);
    };

    const invokeCallback = (promise, sn, startTime) => {
        callback(promise
            .then((result) => {
                const duration = Date.now() - startTime;
                logger(
                    `#${sn} request well completed! duration = ${duration}ms`
                );
                queuedTimers.forEach((timerEntry) =>
                    clearTimeout(timerEntry[1])
                );
                queuedTimers.length = 0;
                return result;
            })
            .catch((e) => {
                return Promise.reject(e);
            }));
    };

    const scheduleFetch = (scheduleSN, delay) => {
        const action = () => {
            doFetch(
                (promise, sn, startTime) =>
                    promise
                        .then(() => invokeCallback(promise, sn, startTime))
                        .catch((error) => {
                            logger(`#${sn} request failed, error message: ${error}`);
                            if (sn === maxRequests - 1) {
                                invokeCallback(promise, sn, startTime);
                            } else if (Date.now() - startTime + 10 < timeout) {
                                const queueHead = queuedTimers.shift();
                                clearTimeout(queueHead[1]);
                                const queueHeadSn = queueHead[0];
                                scheduleFetch(queueHeadSn, 0);
                            }
                        }),
                scheduleSN,
                Date.now()
            );

            const nextSN = scheduleSN + 1;
            if (nextSN < maxRequests) {
                scheduleFetch(nextSN, timeout);
            }
        };

        if (delay <= 0) {
            action();
        } else {
            const timer = setTimeout(() => {
                logger(timeoutMessage(scheduleSN - 1, timeout));
                queuedTimers.shift();
                action();
            }, delay);
            queuedTimers.push([scheduleSN, timer]);
        }
    };

    scheduleFetch(0, 0);
}

function requestWorker(url, init) {
    const {mockTestOnlyFetch} = init;
    if (mockTestOnlyFetch) {
        return mockTestOnlyFetch;
    }

    const isBrowser = new Function("try {return window && this===window;}catch(e){ return false;}");
    const request = (isBrowser() && window.fetch) || require('node-fetch');

    return () => request(url, init);
}

function getLogger(optLogger) {
    if (typeof optLogger !== 'function') {
        return (ignored) => {
        };
    }
    return (args) => optLogger(new Date().toISOString() + ': ' + args);
}

function timeoutMessage(seqNum, timeout) {
    return `Request#${seqNum} no response in ${timeout}ms, fire another request`;
}

function checkArgs(...args) {
    const argsCheckedInfo = [];

    const urlPattern = new RegExp('^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|localhost|' + // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
    if (!!!urlPattern.test(args[0])) {
        argsCheckedInfo.push(`url need to be provided as correct URL string value as web target for this request`);
    }

    if (!args[1] || typeof args[1] !== 'object') {
        argsCheckedInfo.push(`init parameter need to be provided as an object, at least give timeout and maxRequests properties`);
    } else {
        const {timeout, maxRequests} = args[1];
        if (typeof timeout !== 'number' || timeout < 0) {
            argsCheckedInfo.push(
                'In init parameter, timeout property value need to be provided as a positive integer number as a delayed time(in millisecond) before firing another request'
            );
        }
        if (!Number.isInteger(maxRequests) || maxRequests < 0) {
            argsCheckedInfo.push(
                'In init parameter, maxRequests property value need to be provided as a positive integer number as total number of requests to attempt'
            );
        }
    }

    if (typeof args[2] !== 'function') {
        argsCheckedInfo.push(
            `callback need to be provided as a function, will get invoked with a promise as result, either resolved promise or last attempt result(last attempt might be resolved or rejected)`
        );
    }

    if (argsCheckedInfo.length > 0) {
        throw new Error(argsCheckedInfo.join(";\n").toString());
    }
}

robustHttpFetchAsPromise.oneoffFetch = requestWorker;
robustHttpFetchAsPromise.robustHttpFetch = robustHttpFetch;

module.exports = exports = robustHttpFetchAsPromise;











