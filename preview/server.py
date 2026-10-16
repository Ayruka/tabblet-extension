"""Local concept preview with a fixed, read-only status proxy (no CORS changes in production)."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.request import urlopen, Request
import json
import os

class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] != '/preview/api/status':
            return super().do_GET()
        try:
            request = Request('https://tabblet.net/api/public/status', headers={'Accept': 'application/json', 'User-Agent': 'Tabblet-Extension-Preview/1.1'})
            with urlopen(request, timeout=8) as response:
                body = response.read(128 * 1024)
            json.loads(body)
            self.send_response(200)
        except Exception:
            body = b'{"error":"Status temporarily unavailable"}'
            self.send_response(502)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    os.chdir(Path(__file__).resolve().parent.parent)
    ThreadingHTTPServer(('0.0.0.0', 4187), PreviewHandler).serve_forever()
