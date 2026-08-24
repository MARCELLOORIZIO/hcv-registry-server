from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

import_anchor = "const crypto = require('crypto');\n"
import_line = "const crypto = require('crypto');\nconst { signedPayloadFromRawCertificate } = require('./hcv_signature_canonical');\n"
if "require('./hcv_signature_canonical')" not in source:
    if import_anchor not in source:
        raise RuntimeError('crypto import anchor missing')
    source = source.replace(import_anchor, import_line, 1)

old = """  const valid = crypto.verify('RSA-SHA256', Buffer.from(JSON.stringify(signed), 'utf8'), keyObject, Buffer.from(String(cert.signature), 'base64'));
  if (!valid) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Firma HCV non valida.');
"""
new = """  const signatureBytes = Buffer.from(String(cert.signature), 'base64');
  let valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(JSON.stringify(signed), 'utf8'),
    keyObject,
    signatureBytes,
  );
  if (!valid) {
    let lexicalSigned = '';
    try {
      lexicalSigned = signedPayloadFromRawCertificate(raw);
    } catch (_) {}
    if (lexicalSigned) {
      valid = crypto.verify(
        'RSA-SHA256',
        Buffer.from(lexicalSigned, 'utf8'),
        keyObject,
        signatureBytes,
      );
    }
  }
  if (!valid) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Firma HCV non valida.');
"""
if old in source:
    source = source.replace(old, new, 1)
elif 'signedPayloadFromRawCertificate(raw)' not in source:
    raise RuntimeError('certificate signature verification anchor missing')

if "require('./hcv_signature_canonical')" not in source:
    raise RuntimeError('canonical helper import missing')
if 'signedPayloadFromRawCertificate(raw)' not in source:
    raise RuntimeError('canonical signature fallback missing')

path.write_text(source, encoding='utf-8')
print('Dart-compatible HCV signature canonicalization applied')

kyc_patch = Path('tool/apply_kyc_session_safety.py')
if not kyc_patch.exists():
    raise RuntimeError('KYC session safety patch missing')
exec(
    compile(kyc_patch.read_text(encoding='utf-8'), str(kyc_patch), 'exec'),
    {'__name__': '__main__'},
)
