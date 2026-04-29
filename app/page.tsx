"use client";

import type { ChangeEvent, CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";

type Crop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Shadow = {
  enabled: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  opacity: number;
};

type Layer = {
  id: string;
  name: string;
  role: "background" | "panel";
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  z: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  scale: number;
  opacity: number;
  crop: Crop;
  shadow: Shadow;
  visible: boolean;
};

type ExportLayer = {
  id?: string;
  name?: string;
  role?: "background" | "panel";
  source?: {
    width?: number;
    height?: number;
  };
  visible?: boolean;
  transform?: Partial<Pick<Layer, "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ" | "scale" | "opacity">>;
  crop?: Partial<Crop>;
  shadow?: Partial<Shadow>;
};

type ExportConfig = {
  canvas?: Partial<CanvasConfig>;
  layers?: ExportLayer[];
};

type CanvasConfig = {
  width: number;
  height: number;
  perspective: number;
  backgroundColor: string;
};

const STORAGE_KEY = "css3d-card-layout-config-v1";

const defaultCanvas: CanvasConfig = {
  width: 768,
  height: 1376,
  perspective: 1600,
  backgroundColor: "#f7f8f8"
};

const defaultShadow: Shadow = {
  enabled: false,
  x: 0,
  y: 24,
  blur: 44,
  spread: -18,
  opacity: 0.28
};

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readImage(file: File) {
  return new Promise<{ src: string; width: number; height: number }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const image = new Image();
      image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = reject;
      image.src = src;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getLayerCss(layer: Layer) {
  const cropWidth = Math.max(1, layer.crop.width);
  const cropHeight = Math.max(1, layer.crop.height);
  const imageOffsetX = -layer.crop.x;
  const imageOffsetY = -layer.crop.y;
  const shadow = layer.shadow.enabled
    ? `${layer.shadow.x}px ${layer.shadow.y}px ${layer.shadow.blur}px ${layer.shadow.spread}px rgba(18, 22, 26, ${layer.shadow.opacity})`
    : "none";

  return {
    wrapper: {
      width: `${round(cropWidth)}px`,
      height: `${round(cropHeight)}px`,
      transform: [
        `translate3d(${round(layer.x)}px, ${round(layer.y)}px, ${round(layer.z)}px)`,
        `rotateX(${round(layer.rotateX)}deg)`,
        `rotateY(${round(layer.rotateY)}deg)`,
        `rotateZ(${round(layer.rotateZ)}deg)`,
        `scale(${round(layer.scale)})`
      ].join(" "),
      opacity: round(layer.opacity),
      filter: "none",
      boxShadow: shadow
    },
    image: {
      width: `${round(layer.sourceWidth)}px`,
      height: `${round(layer.sourceHeight)}px`,
      transform: `translate(${round(imageOffsetX)}px, ${round(imageOffsetY)}px)`
    },
    crop: {
      x: round(layer.crop.x),
      y: round(layer.crop.y),
      width: round(cropWidth),
      height: round(cropHeight)
    }
  };
}

function getExportJson(canvas: CanvasConfig, layers: Layer[]) {
  return JSON.stringify(
    {
      canvas: {
        ...canvas,
        css: {
          width: `${canvas.width}px`,
          height: `${canvas.height}px`,
          perspective: `${canvas.perspective}px`,
          backgroundColor: canvas.backgroundColor
        }
      },
      layers: layers.map((layer, index) => ({
        id: layer.id,
        name: layer.name,
        role: layer.role,
        order: index,
        source: {
          width: layer.sourceWidth,
          height: layer.sourceHeight,
          replaceableImageSlot: layer.role === "panel"
        },
        visible: layer.visible,
        transform: {
          x: round(layer.x),
          y: round(layer.y),
          z: round(layer.z),
          rotateX: round(layer.rotateX),
          rotateY: round(layer.rotateY),
          rotateZ: round(layer.rotateZ),
          scale: round(layer.scale),
          opacity: round(layer.opacity)
        },
        crop: getLayerCss(layer).crop,
        shadow: layer.shadow,
        css: getLayerCss(layer)
      }))
    },
    null,
    2
  );
}

function NumericControl({
  label,
  value,
  min,
  max,
  step = 0.5,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control">
      <span>{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<CanvasConfig>(defaultCanvas);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [imageStatus, setImageStatus] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonStatus, setJsonStatus] = useState("");
  const [storageStatus, setStorageStatus] = useState("Unsaved");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as { canvas?: CanvasConfig; layers?: Layer[]; selectedId?: string };
      if (parsed.canvas) {
        setCanvas(parsed.canvas);
      }
      if (parsed.layers?.length) {
        setLayers(parsed.layers);
        setSelectedId(parsed.selectedId || parsed.layers[0].id);
        setStorageStatus("Loaded from local storage");
      }
    } catch {
      setStorageStatus("Saved layout could not be loaded");
    }
  }, []);

  const selectedLayer = layers.find((layer) => layer.id === selectedId) || layers[0];
  const exportJson = useMemo(() => getExportJson(canvas, layers), [canvas, layers]);
  const backgroundLayers = layers.filter((layer) => layer.role === "background");
  const panelLayers = layers.filter((layer) => layer.role === "panel");
  const viewportScale = Math.min(1, 620 / canvas.width, 780 / canvas.height);

  useEffect(() => {
    setJsonDraft(exportJson);
  }, [exportJson]);

  function updateSelected(updater: (layer: Layer) => Layer) {
    if (!selectedLayer) {
      return;
    }
    setLayers((current) => current.map((layer) => (layer.id === selectedLayer.id ? updater(layer) : layer)));
    setStorageStatus("Unsaved changes");
  }

  function updateCanvas(patch: Partial<CanvasConfig>) {
    setCanvas((current) => ({ ...current, ...patch }));
    setStorageStatus("Unsaved changes");
  }

  function toggleLayerVisibility(layerId: string, visible: boolean) {
    setLayers((current) => current.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer)));
    setStorageStatus("Unsaved changes");
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>, role: Layer["role"]) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    for (const file of files) {
      const image = await readImage(file);
      const isBackground = role === "background";
      const crop = {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height
      };
      const layer: Layer = {
        id: createId(),
        name: file.name.replace(/\.[^.]+$/, ""),
        role,
        src: image.src,
        sourceWidth: image.width,
        sourceHeight: image.height,
        x: isBackground ? 0 : Math.round((canvas.width - Math.min(image.width, 420)) / 2),
        y: isBackground ? 0 : Math.round((canvas.height - Math.min(image.height, 560)) / 2),
        z: isBackground ? -80 : 0,
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
        scale: isBackground ? Math.max(canvas.width / image.width, canvas.height / image.height) : 1,
        opacity: 1,
        crop,
        shadow: { ...defaultShadow },
        visible: true
      };

      setLayers((current) => (isBackground ? [layer, ...current.filter((item) => item.role !== "background")] : [...current, layer]));
      setSelectedId(layer.id);
      setStorageStatus("Unsaved changes");
    }
  }

  async function changeSelectedImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !selectedLayer) {
      return;
    }

    const image = await readImage(file);
    updateSelected((layer) => ({
      ...layer,
      name: file.name.replace(/\.[^.]+$/, ""),
      src: image.src,
      sourceWidth: image.width,
      sourceHeight: image.height,
      crop: {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height
      }
    }));
  }

  function saveLayout() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ canvas, layers, selectedId }));
    setStorageStatus("Saved to local storage");
  }

  async function copyJson() {
    await navigator.clipboard.writeText(exportJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function loadJsonConfig() {
    try {
      const parsed = JSON.parse(jsonDraft) as ExportConfig;
      const existingById = new Map(layers.map((layer) => [layer.id, layer]));
      const nextCanvas: CanvasConfig = {
        ...canvas,
        ...parsed.canvas
      };
      delete (nextCanvas as Partial<CanvasConfig> & { css?: unknown }).css;

      const nextLayers = (parsed.layers || []).map((incomingLayer, index): Layer => {
        const existingLayer = incomingLayer.id ? existingById.get(incomingLayer.id) : undefined;
        const sourceWidth = incomingLayer.source?.width || existingLayer?.sourceWidth || 600;
        const sourceHeight = incomingLayer.source?.height || existingLayer?.sourceHeight || 800;
        const crop = {
          x: incomingLayer.crop?.x ?? existingLayer?.crop.x ?? 0,
          y: incomingLayer.crop?.y ?? existingLayer?.crop.y ?? 0,
          width: incomingLayer.crop?.width ?? existingLayer?.crop.width ?? sourceWidth,
          height: incomingLayer.crop?.height ?? existingLayer?.crop.height ?? sourceHeight
        };

        return {
          id: incomingLayer.id || existingLayer?.id || createId(),
          name: incomingLayer.name || existingLayer?.name || `Layer ${index + 1}`,
          role: incomingLayer.role || existingLayer?.role || "panel",
          src: existingLayer?.src || "",
          sourceWidth,
          sourceHeight,
          x: incomingLayer.transform?.x ?? existingLayer?.x ?? 0,
          y: incomingLayer.transform?.y ?? existingLayer?.y ?? 0,
          z: incomingLayer.transform?.z ?? existingLayer?.z ?? 0,
          rotateX: incomingLayer.transform?.rotateX ?? existingLayer?.rotateX ?? 0,
          rotateY: incomingLayer.transform?.rotateY ?? existingLayer?.rotateY ?? 0,
          rotateZ: incomingLayer.transform?.rotateZ ?? existingLayer?.rotateZ ?? 0,
          scale: incomingLayer.transform?.scale ?? existingLayer?.scale ?? 1,
          opacity: incomingLayer.transform?.opacity ?? existingLayer?.opacity ?? 1,
          crop: {
            x: clamp(crop.x, 0, sourceWidth - 1),
            y: clamp(crop.y, 0, sourceHeight - 1),
            width: clamp(crop.width, 1, sourceWidth - crop.x),
            height: clamp(crop.height, 1, sourceHeight - crop.y)
          },
          shadow: {
            ...defaultShadow,
            ...existingLayer?.shadow,
            ...incomingLayer.shadow
          },
          visible: incomingLayer.visible ?? existingLayer?.visible ?? true
        };
      });

      setCanvas(nextCanvas);
      setLayers(nextLayers);
      setSelectedId(nextLayers[0]?.id || "");
      setStorageStatus("Loaded from JSON");
      setJsonStatus("JSON loaded");
      window.setTimeout(() => setJsonStatus(""), 1600);
    } catch {
      setJsonStatus("Invalid JSON");
    }
  }

  async function saveCanvasImage() {
    if (!canvasRef.current) {
      return;
    }

    setImageStatus("Saving image...");
    setIsCapturing(true);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    try {
      const dataUrl = await toPng(canvasRef.current, {
        cacheBust: true,
        pixelRatio: 1,
        width: canvas.width,
        height: canvas.height
      });
      const link = document.createElement("a");
      link.download = `card-layout-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      link.href = dataUrl;
      link.click();
      setImageStatus("Image saved");
      window.setTimeout(() => setImageStatus(""), 1600);
    } finally {
      setIsCapturing(false);
    }
  }

  async function copyCanvasImage() {
    if (!canvasRef.current) {
      return;
    }

    setImageStatus("Copying image...");
    setIsCapturing(true);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    try {
      const blob = await toBlob(canvasRef.current, {
        cacheBust: true,
        pixelRatio: 1,
        width: canvas.width,
        height: canvas.height
      });

      if (!blob) {
        setImageStatus("Image copy failed");
        return;
      }

      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob
        })
      ]);
      setImageStatus("Image copied");
      window.setTimeout(() => setImageStatus(""), 1600);
    } finally {
      setIsCapturing(false);
    }
  }

  function duplicateSelected() {
    if (!selectedLayer) {
      return;
    }
    const duplicate = {
      ...selectedLayer,
      id: createId(),
      name: `${selectedLayer.name} copy`,
      x: selectedLayer.x + 24,
      y: selectedLayer.y + 24
    };
    setLayers((current) => [...current, duplicate]);
    setSelectedId(duplicate.id);
    setStorageStatus("Unsaved changes");
  }

  function removeSelected() {
    if (!selectedLayer) {
      return;
    }
    setLayers((current) => current.filter((layer) => layer.id !== selectedLayer.id));
    setSelectedId(layers.find((layer) => layer.id !== selectedLayer.id)?.id || "");
    setStorageStatus("Unsaved changes");
  }

  function moveSelectedPanel(direction: -1 | 1) {
    if (!selectedLayer || selectedLayer.role !== "panel") {
      return;
    }

    setLayers((current) => {
      const panelIndexes = current.reduce<number[]>((indexes, layer, index) => {
        if (layer.role === "panel") {
          indexes.push(index);
        }
        return indexes;
      }, []);
      const panelPosition = panelIndexes.findIndex((index) => current[index].id === selectedLayer.id);
      const nextPanelPosition = clamp(panelPosition + direction, 0, panelIndexes.length - 1);

      if (panelPosition === nextPanelPosition) {
        return current;
      }

      const next = [...current];
      const fromIndex = panelIndexes[panelPosition];
      const toIndex = panelIndexes[nextPanelPosition];
      const movingLayer = next[fromIndex];
      next[fromIndex] = next[toIndex];
      next[toIndex] = movingLayer;
      return next;
    });
    setStorageStatus("Unsaved changes");
  }

  const stageStyle = {
    width: canvas.width,
    height: canvas.height,
    transform: `scale(${viewportScale})`,
    transformOrigin: "top left",
    backgroundColor: canvas.backgroundColor,
    perspective: `${canvas.perspective}px`
  } satisfies CSSProperties;

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">3D CSS Explorer</p>
            <h1>Greeting card scene layout</h1>
          </div>
          <div className="topbar-actions">
            <label className="button">
              Background
              <input type="file" accept="image/*" onChange={(event) => addFiles(event, "background")} />
            </label>
            <label className="button primary">
              Add panels
              <input type="file" accept="image/*" multiple onChange={(event) => addFiles(event, "panel")} />
            </label>
          </div>
        </div>

        <div className="stage-viewport" style={{ width: canvas.width * viewportScale, height: canvas.height * viewportScale }}>
          <div className={`canvas ${isCapturing ? "is-capturing" : ""}`} ref={canvasRef} style={stageStyle}>
            <div className="background-plane">
              {backgroundLayers.map((layer) => {
                const css = getLayerCss(layer);
                return (
                  <button
                    className={`layer-frame background-frame ${selectedId === layer.id ? "selected" : ""}`}
                    key={layer.id}
                    onClick={() => setSelectedId(layer.id)}
                    style={{
                      width: css.wrapper.width,
                      height: css.wrapper.height,
                      transform: [
                        `translate3d(${round(layer.x)}px, ${round(layer.y)}px, 0)`,
                        `rotateZ(${round(layer.rotateZ)}deg)`,
                        `scale(${round(layer.scale)})`
                      ].join(" "),
                      opacity: layer.visible ? css.wrapper.opacity : 0.18,
                      boxShadow: css.wrapper.boxShadow
                    }}
                    type="button"
                    title={layer.name}
                  >
                    {layer.src ? (
                      <>
                        {/* User-uploaded data URLs need normal image rendering inside crop frames. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={layer.src}
                          alt=""
                          draggable={false}
                          style={{
                            width: css.image.width,
                            height: css.image.height,
                            transform: css.image.transform
                          }}
                        />
                      </>
                    ) : (
                      <span className="missing-image">Replace image</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="canvas-plane">
              {panelLayers.map((layer) => {
                const css = getLayerCss(layer);
                return (
                  <button
                    className={`layer-frame ${selectedId === layer.id ? "selected" : ""}`}
                    key={layer.id}
                    onClick={() => setSelectedId(layer.id)}
                    style={{
                      width: css.wrapper.width,
                      height: css.wrapper.height,
                      transform: css.wrapper.transform,
                      opacity: layer.visible ? css.wrapper.opacity : 0.18,
                      boxShadow: css.wrapper.boxShadow,
                      zIndex: 10 + layers.indexOf(layer)
                    }}
                    type="button"
                    title={layer.name}
                  >
                    {layer.src ? (
                      <>
                        {/* User-uploaded data URLs need normal image rendering inside crop frames. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={layer.src}
                          alt=""
                          draggable={false}
                          style={{
                            width: css.image.width,
                            height: css.image.height,
                            transform: css.image.transform
                          }}
                        />
                      </>
                    ) : (
                      <span className="missing-image">Replace image</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <aside className="sidebar">
        <div className="panel">
          <div className="panel-heading">
            <h2>Canvas</h2>
            <span>{storageStatus}</span>
          </div>
          <div className="two-col">
            <label>
              Width
              <input type="number" value={canvas.width} onChange={(event) => updateCanvas({ width: Number(event.target.value) })} />
            </label>
            <label>
              Height
              <input type="number" value={canvas.height} onChange={(event) => updateCanvas({ height: Number(event.target.value) })} />
            </label>
          </div>
          <NumericControl label="Perspective" value={canvas.perspective} min={200} max={4000} step={20} onChange={(value) => updateCanvas({ perspective: value })} />
          <label>
            Background color
            <input type="color" value={canvas.backgroundColor} onChange={(event) => updateCanvas({ backgroundColor: event.target.value })} />
          </label>
        </div>

        <div className="panel layer-list">
          <div className="panel-heading">
            <h2>Layers</h2>
            <span>{layers.length}</span>
          </div>
          {layers.length === 0 ? <p className="empty">Upload a background or panel image.</p> : null}
          {layers.map((layer) => (
            <div className={`layer-item ${selectedId === layer.id ? "active" : ""}`} key={layer.id}>
              <label className="visibility-toggle" title={layer.visible ? "Hide layer" : "Show layer"}>
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(event) => toggleLayerVisibility(layer.id, event.target.checked)}
                />
              </label>
              <button onClick={() => setSelectedId(layer.id)} type="button">
                <span>{layer.name}</span>
                <small>{layer.role}</small>
              </button>
            </div>
          ))}
          <div className="button-row layer-actions">
            {selectedLayer?.role === "panel" ? (
              <label className="button file-control primary">
                Replace Image
                <input type="file" accept="image/*" onChange={changeSelectedImage} />
              </label>
            ) : null}
            <button type="button" onClick={() => moveSelectedPanel(-1)} disabled={selectedLayer?.role !== "panel"}>
              Backward
            </button>
            <button type="button" onClick={() => moveSelectedPanel(1)} disabled={selectedLayer?.role !== "panel"}>
              Forward
            </button>
            <button type="button" onClick={duplicateSelected} disabled={!selectedLayer}>
              Duplicate
            </button>
            <button type="button" onClick={removeSelected} disabled={!selectedLayer}>
              Delete
            </button>
          </div>
        </div>

        {selectedLayer ? (
          <div className="panel controls-panel">
            <div className="panel-heading">
              <h2>Selected</h2>
              <span>{selectedLayer.role}</span>
            </div>
            <label>
              Name
              <input value={selectedLayer.name} onChange={(event) => updateSelected((layer) => ({ ...layer, name: event.target.value }))} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={selectedLayer.visible} onChange={(event) => updateSelected((layer) => ({ ...layer, visible: event.target.checked }))} />
              Visible
            </label>

            <div className="control-group">
              <h3>Position</h3>
              <NumericControl label="X" value={selectedLayer.x} min={-canvas.width} max={canvas.width} onChange={(value) => updateSelected((layer) => ({ ...layer, x: value }))} />
              <NumericControl label="Y" value={selectedLayer.y} min={-canvas.height} max={canvas.height} onChange={(value) => updateSelected((layer) => ({ ...layer, y: value }))} />
              <NumericControl label="Z" value={selectedLayer.z} min={-1600} max={1600} onChange={(value) => updateSelected((layer) => ({ ...layer, z: value }))} />
            </div>

            <div className="control-group">
              <h3>Transform</h3>
              <NumericControl label="Scale" value={selectedLayer.scale} min={0.05} max={4} step={0.01} onChange={(value) => updateSelected((layer) => ({ ...layer, scale: value }))} />
              <NumericControl label="Rotate X" value={selectedLayer.rotateX} min={-90} max={90} onChange={(value) => updateSelected((layer) => ({ ...layer, rotateX: value }))} />
              <NumericControl label="Rotate Y" value={selectedLayer.rotateY} min={-90} max={90} onChange={(value) => updateSelected((layer) => ({ ...layer, rotateY: value }))} />
              <NumericControl label="Rotate Z" value={selectedLayer.rotateZ} min={-180} max={180} onChange={(value) => updateSelected((layer) => ({ ...layer, rotateZ: value }))} />
              <NumericControl label="Opacity" value={selectedLayer.opacity} min={0} max={1} onChange={(value) => updateSelected((layer) => ({ ...layer, opacity: value }))} />
            </div>

            <div className="control-group">
              <h3>Crop</h3>
              <NumericControl
                label="Left"
                value={selectedLayer.crop.x}
                min={0}
                max={selectedLayer.sourceWidth - 1}
                onChange={(value) =>
                  updateSelected((layer) => ({
                    ...layer,
                    crop: { ...layer.crop, x: value, width: clamp(layer.crop.width, 1, layer.sourceWidth - value) }
                  }))
                }
              />
              <NumericControl
                label="Top"
                value={selectedLayer.crop.y}
                min={0}
                max={selectedLayer.sourceHeight - 1}
                onChange={(value) =>
                  updateSelected((layer) => ({
                    ...layer,
                    crop: { ...layer.crop, y: value, height: clamp(layer.crop.height, 1, layer.sourceHeight - value) }
                  }))
                }
              />
              <NumericControl
                label="Width"
                value={selectedLayer.crop.width}
                min={1}
                max={selectedLayer.sourceWidth - selectedLayer.crop.x}
                onChange={(value) => updateSelected((layer) => ({ ...layer, crop: { ...layer.crop, width: value } }))}
              />
              <NumericControl
                label="Height"
                value={selectedLayer.crop.height}
                min={1}
                max={selectedLayer.sourceHeight - selectedLayer.crop.y}
                onChange={(value) => updateSelected((layer) => ({ ...layer, crop: { ...layer.crop, height: value } }))}
              />
            </div>

            <div className="control-group">
              <h3>Shadow</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedLayer.shadow.enabled}
                  onChange={(event) => updateSelected((layer) => ({ ...layer, shadow: { ...layer.shadow, enabled: event.target.checked } }))}
                />
                Drop shadow
              </label>
              <NumericControl label="Shadow X" value={selectedLayer.shadow.x} min={-120} max={120} onChange={(value) => updateSelected((layer) => ({ ...layer, shadow: { ...layer.shadow, x: value } }))} />
              <NumericControl label="Shadow Y" value={selectedLayer.shadow.y} min={-120} max={160} onChange={(value) => updateSelected((layer) => ({ ...layer, shadow: { ...layer.shadow, y: value } }))} />
              <NumericControl label="Blur" value={selectedLayer.shadow.blur} min={0} max={180} onChange={(value) => updateSelected((layer) => ({ ...layer, shadow: { ...layer.shadow, blur: value } }))} />
              <NumericControl label="Spread" value={selectedLayer.shadow.spread} min={-80} max={80} onChange={(value) => updateSelected((layer) => ({ ...layer, shadow: { ...layer.shadow, spread: value } }))} />
              <NumericControl label="Opacity" value={selectedLayer.shadow.opacity} min={0} max={1} onChange={(value) => updateSelected((layer) => ({ ...layer, shadow: { ...layer.shadow, opacity: value } }))} />
            </div>
          </div>
        ) : null}

        <div className="panel export-panel">
          <div className="panel-heading">
            <h2>Configuration</h2>
            <span>{copied ? "Copied" : "JSON"}</span>
          </div>
          <textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} />
          <div className="button-row">
            <button type="button" className="primary" onClick={copyJson}>
              Copy JSON
            </button>
            <button type="button" onClick={saveLayout}>
              Save layout
            </button>
            <button type="button" onClick={loadJsonConfig}>
              Load JSON
            </button>
            {jsonStatus ? <span className="json-status">{jsonStatus}</span> : null}
          </div>
          <div className="button-row image-actions">
            <button type="button" className="primary" onClick={copyCanvasImage}>
              Copy Image
            </button>
            <button type="button" onClick={saveCanvasImage}>
              Save Image
            </button>
            {imageStatus ? <span>{imageStatus}</span> : null}
          </div>
        </div>
      </aside>
    </main>
  );
}
