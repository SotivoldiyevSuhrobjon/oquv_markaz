"""Statik fayllar (frontend) uchun xavfsizlik sarlavhalari. WhiteNoise Django middleware'laridan oldin javob beradi,
shuning uchun X-Frame-Options va CSP shu yerda qo'shiladi."""

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)


def add_security_headers(headers, path, url):
    headers["X-Frame-Options"] = "DENY"
    headers["X-Content-Type-Options"] = "nosniff"
    if str(path).endswith(".html"):
        headers["Content-Security-Policy"] = CSP
