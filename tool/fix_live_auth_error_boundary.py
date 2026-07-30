from pathlib import Path

path = Path('auth_api.js')
source = path.read_text()
old = """module.exports = {
  handleAuth,
};
"""
new = """async function handleAuthRequest(req, res, url) {
  try {
    return await handleAuth(req, res, url);
  } catch (error) {
    return sendJson(
      res,
      error.statusCode || 500,
      error.statusCode
        ? publicError(error)
        : {
            ok: false,
            error: 'ERRORE_SERVER',
            message: 'Operazione account non disponibile.',
          },
    );
  }
}

module.exports = {
  handleAuth: handleAuthRequest,
};
"""
if new not in source:
    if source.count(old) != 1:
        raise RuntimeError('auth_api export anchor not found exactly once')
    source = source.replace(old, new, 1)
    path.write_text(source)
print('Live Account API error boundary installed')
