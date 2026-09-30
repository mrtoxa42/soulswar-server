# SoulsWarAI Server

WebSocket server for SoulsWarAI.

## Deployment on Render.com (Free Tier)

1. Create a free account on [Render](https://render.com/).
2. Click "New" and select "Web Service".
3. Connect your GitHub repository containing this server code.
4. Render will automatically detect the `Dockerfile`.
5. Configure the service:
   - **Environment:** Docker
   - **Plan:** Free
   - **Branch:** main (or your default branch)
6. Add Environment Variable:
   - `PORT`: `8080` (Optional, default is 8080)
7. Click "Create Web Service".

Render handles SSL termination automatically, so your WebSocket URL will be available at `wss://<your-render-url>.onrender.com`.
