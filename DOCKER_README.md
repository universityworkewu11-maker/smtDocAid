Docker quick-start

Prerequisites:
- Docker installed and running on your machine.

Build and run:

```powershell
cd d:\Amitub\smtDocAid-main
# build the image (may take several minutes)
docker build -t smt-doc-aid:latest .

# run the container and map port 3000
docker run -p 3000:3000 --rm smt-doc-aid:latest
```

Open http://localhost:3000 in your browser. The app will be served from the freshly built `build/` directory inside the container.

Notes:
- If Docker is unavailable on your machine, consider running this on a cloud VM or using Vercel for a cloud build & deploy.
- If you still see stale content, do a hard refresh and clear any service worker caches (DevTools → Application → Service Workers → Unregister).