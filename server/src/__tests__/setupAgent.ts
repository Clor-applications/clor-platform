import http from 'node:http';
import https from 'node:https';

/**
 * Disable HTTP keep-alive for the whole suite.
 *
 * Node 19+ turns keep-alive on for the global agent. supertest starts a fresh
 * server on an ephemeral port for every request, and when the OS reuses one of
 * those ports within the agent's 5-second keep-alive window, superagent hands
 * the new request a cached socket belonging to the previous, now-closed server.
 * The result is an intermittent "socket hang up" or "Parse Error: Expected
 * HTTP/" that has nothing to do with the test that hits it.
 *
 * With keep-alive off every request opens a fresh socket, which is the right
 * trade for a test suite: correctness over connection reuse.
 */
http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });
