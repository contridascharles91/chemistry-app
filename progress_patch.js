{
  "version": 2,
  "outputDirectory": "frontend",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=(), payment=()"
        },
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=63072000; includeSubDomains; preload"
        },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://3Dmol.org; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com; font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com https://cdn.jsdelivr.net data: blob:; img-src 'self' data: blob: https:; connect-src 'self' https://chunksai.up.railway.app https://chemistry-app-production.up.railway.app https://openrouter.ai https://*.supabase.co wss://*.supabase.co https://unpkg.com https://cdn.jsdelivr.net https://3Dmol.org https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self' blob:; frame-ancestors 'none';"
        }
      ]
    },
    {
      "source": "/public/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/study_dashboard.html",
      "destination": "/study_dashboard.html"
    },
    {
      "source": "/subscribe.html",
      "destination": "/subscribe.html"
    },
    {
      "source": "/admin.html",
      "destination": "/admin.html"
    },
    {
      "source": "/paev_ui.html",
      "destination": "/paev_ui.html"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
