import { Router } from 'express';
import { openapiSpec } from '../docs/openapi.js';

const router = Router();

// Spec OpenAPI en crudo (la consume Swagger UI y cualquier cliente externo)
router.get('/openapi.json', (_, res) => res.json(openapiSpec));

// Swagger UI servido desde CDN (sin dependencias npm).
const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tecnovend API · Documentación</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" href="data:," />
  <style>body { margin: 0 } .topbar { display: none }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 0,
        tryItOutEnabled: true,
      });
    };
  </script>
</body>
</html>`;

router.get('/', (_, res) => res.type('html').send(html));

export default router;
