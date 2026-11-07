# A local stand-in for the two Google endpoints the backup job calls: the
# metadata server's token and the Cloud Storage JSON upload API. Test only
# (deploy/backup/test-local.sh); it never talks to Google.
#
#   python3 -I gcs-standin.py PORT [--wrong-md5]
#
# Like the real bucket for a create-only account: an existing name answers 412
# (ifGenerationMatch=0), a wrong token 401. GET /_list lists stored names.
import base64, hashlib, json, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "standin-token"
STORE = {}
WRONG_MD5 = "--wrong-md5" in sys.argv


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.endswith("/service-accounts/default/token"):
            if self.headers.get("Metadata-Flavor") != "Google":
                return self._send(403, {})
            return self._send(200, {"access_token": TOKEN, "expires_in": 3599, "token_type": "Bearer"})
        if self.path == "/_list":
            return self._send(200, sorted(STORE))
        self._send(404, {})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self._send(401, {"error": {"code": 401}})
        if q.get("uploadType") != ["media"] or q.get("ifGenerationMatch") != ["0"] or "name" not in q:
            return self._send(400, {"error": {"code": 400}})
        bucket = u.path.split("/b/")[1].split("/")[0]
        name = bucket + "/" + q["name"][0]
        if name in STORE:
            return self._send(412, {"error": {"code": 412, "message": "conditionNotMet"}})
        STORE[name] = body
        md5 = "AAAAAAAAAAAAAAAAAAAAAA==" if WRONG_MD5 else base64.b64encode(hashlib.md5(body).digest()).decode()
        self._send(200, {"name": q["name"][0], "size": str(len(body)), "md5Hash": md5})


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
