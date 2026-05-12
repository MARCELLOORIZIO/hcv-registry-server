# HCV Registry Server MVP

Server minimale per salvare e recuperare certificati HCV tramite HCV-ID.

## Avvio su Windows

Apri un terminale in questa cartella e lancia:

```bash
node server.js
```

Dovresti vedere:

```text
HCV Registry listening on http://0.0.0.0:8080
```

## Test dal browser

Apri:

```text
http://localhost:8080/health
```

## Endpoint

### Upload certificato

```text
POST /api/certificate
```

Body JSON:

```json
{
  "hcvId": "HCV-DE27F535",
  "certificate": { }
}
```

### Recupero certificato

```text
GET /api/certificate/HCV-DE27F535
```

## Android Emulator

Nel codice Flutter il server è configurato su:

```dart
http://10.0.2.2:8080
```

Questo è corretto per emulator Android.

## Telefono Android reale

Se usi un telefono fisico, sostituisci in `hcv_registry_service.dart`:

```dart
http://10.0.2.2:8080
```

con l'IP locale del PC, per esempio:

```dart
http://192.168.1.50:8080
```
