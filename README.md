# 3D CSS Explorer

Prototype Next.js app for laying out greeting card product imagery with reproducible 3D CSS configuration.

## Local development

```bash
npm install
npm run dev
```

The app is designed for Vercel deployment from GitHub.

## Workflow

1. Upload one background image for the canvas.
2. Upload one or more panel images.
3. Select each layer and adjust crop, position, scale, 3D rotation, opacity, and drop shadow.
4. Save the layout to local storage when you want to reuse it in this browser.
5. Copy the JSON configuration for a reproducible layout.

The default canvas is `768px` by `1376px`. Canvas size and perspective are configurable.

## JSON output

The exported JSON separates the reusable transform/crop/shadow configuration from the image content. Panel layers are marked with `replaceableImageSlot: true`, which gives engineers a stable contract for reproducing the composition by swapping source images while preserving CSS layout data.
