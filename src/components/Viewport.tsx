import {sharpeningPreviewSize} from '../types/sharpening';
import {DetailLoupe} from './Sharpening';
import { ColorMixerPanel } from './ColorMixer';
import { ColorMixerSettings, HSL, MIXER_COLORS, normalizeColorMixer } from '../types/colorMixer';
import { mixerBandWeights, rgbToHsl, pointFromColor } from '../engine/color/colorMixer';
import { CameraEffects } from './CameraEffects';
import { ToneCurveOverlay, Histogram } from './ToneCurve';
import { histogramFromPixels } from '../engine/color/userCurves';
import { getMargarinePreset } from '../presets/margarine';
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { WebGL2FilmRenderer } from '../engine/renderer/webglRenderer';
import { loadCubeLut, ParsedLut3D } from '../engine/color/lutLoader';
import { FILM_PROFILES } from '../films/registry';
import { Columns, Eye, ZoomIn, ZoomOut, Maximize2, Sparkles, AlertCircle } from 'lucide-react';
import { ImageDropzone } from './ImageDropzone';

// Clamp pan based on viewport geometry and zoom level
function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  fittedWidth: number,
  fittedHeight: number,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number } {
  if (zoom <= 1.001) {
    return { x: 0, y: 0 };
  }
  const dispW = fittedWidth * zoom;
  const dispH = fittedHeight * zoom;
  const margin = 40; // Allow comfortable inspection of image corners/edges

  // Allow pan to navigate all image edges and anchor details under cursor
  const maxPanX = Math.abs(dispW - containerWidth) / 2 + margin;
  const maxPanY = Math.abs(dispH - containerHeight) / 2 + margin;

  return {
    x: Math.min(maxPanX, Math.max(-maxPanX, pan.x)),
    y: Math.min(maxPanY, Math.max(-maxPanY, pan.y)),
  };
}

export const Viewport: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGL2FilmRenderer | null>(null);
  const currentLutRef = useRef<ParsedLut3D | null>(null);

  const {
    image,
    activeFilmId,
    activePresetId,
    adjustments,
    camera,
    sharpening,sharpeningMask,isSharpeningDragging,
    colorMixer,isColorMixerOpen,mixerTool,mixerVisualize,mixerPointId,
    isToneCurveOpen,
    curves,
    compareMode,
    setCompareMode,
    splitPos,
    setSplitPos,
    zoom,
    pan,
    setPan,
    setZoomAndPan,
    resetZoomPan,
  } = useEditorStore();

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isPressHolding, setIsPressHolding] = useState(false);
  const [rendererError, setRendererError] = useState<string | null>(null);

  // Interaction refs
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Touch gesture state
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    zoom: number;
    pan: { x: number; y: number };
  } | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  // Latest state references for WebGL callbacks
  const imageRef = useRef(image);
  imageRef.current = image;
  const filmIdRef = useRef(activeFilmId);
  filmIdRef.current = activeFilmId;
  const sharpRef=useRef(sharpening);sharpRef.current=sharpening;
  const draftRef=useRef(isSharpeningDragging);draftRef.current=isSharpeningDragging;
  const maskRef=useRef(sharpeningMask);maskRef.current=sharpeningMask;
  const mixerRef=useRef(colorMixer);mixerRef.current=colorMixer;
  const visualizeRef=useRef<string|null>(null);visualizeRef.current=isColorMixerOpen&&mixerVisualize?(mixerPointId||colorMixer.points[0]?.id||null):null;
  const lutFilmRef=useRef('');
  const mixerGesture=useRef<{pointerId:number|null;y:number;basis:ColorMixerSettings;weights:number[];axis:'hue'|'saturation'|'luminance'}|null>(null);
  useLayoutEffect(()=>{
    mixerGesture.current=null;
    return()=>{if(mixerGesture.current?.pointerId!=null){const state=useEditorStore.getState();state.setColorMixer(state.colorMixer);mixerGesture.current=null;}};
  },[mixerTool,image]);
  const isToneCurveOpenRef = useRef(isToneCurveOpen); isToneCurveOpenRef.current = isToneCurveOpen;
  const curvesRef = useRef(curves); curvesRef.current = curves;
  const histogramCanvas = useRef<HTMLCanvasElement | null>(null);
  const histogramTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histogram, setHistogram] = useState<number[][] | null>(null);
  useEffect(()=>()=>{if(histogramTimer.current)clearTimeout(histogramTimer.current);if(rafIdRef.current)cancelAnimationFrame(rafIdRef.current);histogramTimer.current=null;rafIdRef.current=null;},[]);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const adjustmentsRef = useRef(adjustments);
  adjustmentsRef.current = adjustments;
  const compareModeRef = useRef(compareMode);
  compareModeRef.current = compareMode;
  const splitPosRef = useRef(splitPos);
  splitPosRef.current = splitPos;
  const isPressHoldingRef = useRef(isPressHolding);
  isPressHoldingRef.current = isPressHolding;

  // Persistent ResizeObserver observing container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const roundedW = Math.round(width);
        const roundedH = Math.round(height);
        setContainerSize((prev) => {
          if (prev.width === roundedW && prev.height === roundedH) return prev;
          return { width: roundedW, height: roundedH };
        });
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute fitted display dimensions preserving aspect ratio
  const computeFittedDisplaySize = () => {
    if (!image) {
      return { width: 0, height: 0 };
    }

    const cw = containerSize.width;
    const ch = containerSize.height;

    // Use container dimensions or viewport fallback if first mount
    const availContainerW = cw > 0 ? cw : (typeof window !== 'undefined' ? window.innerWidth : 800);
    const availContainerH = ch > 0 ? ch : (typeof window !== 'undefined' ? window.innerHeight - 100 : 600);

    const pad = availContainerW < 640 ? 12 : 24;
    const availW = Math.max(10, availContainerW - pad * 2);
    const availH = Math.max(10, availContainerH - pad * 2);

    const imgW = image.previewWidth;
    const imgH = image.previewHeight;

    const fitScale = Math.min(availW / imgW, availH / imgH);
    const fittedW = Math.max(1, Math.round(imgW * fitScale));
    const fittedH = Math.max(1, Math.round(imgH * fitScale));

    return {
      width: fittedW,
      height: fittedH,
    };
  };

  const displaySize = computeFittedDisplaySize();
  const fittedSizeRef = useRef(displaySize);
  fittedSizeRef.current = displaySize;

  // Coalesced render execution with requestAnimationFrame
  const rafIdRef = useRef<number | null>(null);
  const requestRender = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const renderer = rendererRef.current;
      if (!renderer || !renderer.isReady() || !imageRef.current) return;

      try {
        const effectiveMode = isPressHoldingRef.current ? 'original' : compareModeRef.current;
        const current=imageRef.current,canvas=canvasRef.current;
        const draft=draftRef.current&&sharpRef.current.mode==='advanced'&&(sharpRef.current.amount>0||maskRef.current)&&effectiveMode!=='original';
        const target=sharpeningPreviewSize(current.previewWidth,current.previewHeight,fittedSizeRef.current.width,fittedSizeRef.current.height,useEditorStore.getState().zoom,draft);
        if(canvas&&(canvas.width!==target.width||canvas.height!==target.height)){canvas.width=target.width;canvas.height=target.height;}
        renderer.render({
          adjustments: adjustmentsRef.current,
          camera: cameraRef.current,
          curves: curvesRef.current,
          colorMixer:mixerRef.current,
          sharpening:sharpRef.current,sharpeningDraft:draftRef.current,sharpeningMask:maskRef.current,sourceWidth:imageRef.current.originalWidth,sourceHeight:imageRef.current.originalHeight,
          mixerVisualize:visualizeRef.current,
          filmId: filmIdRef.current,
          compareMode: effectiveMode,
          splitPos: splitPosRef.current,
          seed: 42.0,
        });
        window.dispatchEvent(new Event('film-preview-rendered'));
        if (isToneCurveOpenRef.current && !histogramTimer.current) histogramTimer.current = setTimeout(()=>{
          histogramTimer.current = null;
          const canvas = canvasRef.current;
          if (!canvas || !isToneCurveOpenRef.current) return;
          const sample = histogramCanvas.current ||= document.createElement('canvas');
          sample.width = 192; sample.height = Math.max(1,Math.round(192*canvas.height/canvas.width));
          sample.height = Math.min(sample.height,192);
          const ctx=sample.getContext('2d',{willReadFrequently:true});
          if(ctx){ctx.drawImage(canvas,0,0,sample.width,sample.height);setHistogram(histogramFromPixels(ctx.getImageData(0,0,sample.width,sample.height).data));}
        },120);
        setRendererError(null);
      } catch (err: any) {
        console.error('Render failure:', err);
        setRendererError('WebGL render error. Please reload.');
      }
    });
  }, []);

  // Stable Canvas Callback Ref: initializes WebGL2 precisely once per canvas instance
  const handleCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (!node) {
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      canvasRef.current = null;
      return;
    }

    canvasRef.current = node;

    const renderer = new WebGL2FilmRenderer(node, () => {
      // WebGL context restored recovery
      const curImg = imageRef.current;
      if (curImg && rendererRef.current) {
        rendererRef.current.setImage(curImg.previewCanvas, curImg.previewWidth, curImg.previewHeight);
        if (currentLutRef.current) {
          rendererRef.current.setLut(currentLutRef.current);
        }
        requestRender();
      }
    });

    if (!renderer.isReady()) {
      setRendererError('WebGL2 context could not be initialized.');
      return;
    }

    rendererRef.current = renderer;

    const curImg = imageRef.current;
    if (curImg) {
      node.width = curImg.previewWidth;
      node.height = curImg.previewHeight;
      renderer.setImage(curImg.previewCanvas, curImg.previewWidth, curImg.previewHeight);
    }

    if (currentLutRef.current) {
      renderer.setLut(currentLutRef.current);
    }
    requestRender();
  }, [requestRender]);

  // Load active film LUT
  useEffect(() => {
    const profile = FILM_PROFILES[activeFilmId];
    if (!profile) return;

    let isCancelled = false;
    setRendererError(null);
    loadCubeLut(profile.lutFile)
      .then((lut) => {
        if (isCancelled) return;
        currentLutRef.current = lut;
        lutFilmRef.current=activeFilmId;
        if (rendererRef.current && rendererRef.current.isReady()) {
          rendererRef.current.setLut(lut);
          requestRender();
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error('Failed to load LUT:', err);
        setRendererError(`Failed to load ${profile.name} LUT`);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeFilmId, requestRender]);

  // Update canvas backing-store & texture when image changes
  useEffect(() => {
    if (!image) return;

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;

    if (canvas) {
      canvas.width = image.previewWidth;
      canvas.height = image.previewHeight;
    }

    if (renderer && renderer.isReady()) {
      renderer.setImage(image.previewCanvas, image.previewWidth, image.previewHeight);
      if (currentLutRef.current) {
        renderer.setLut(currentLutRef.current);
      }
      requestRender();
    }
  }, [image, requestRender]);

  // Render on adjustments or comparison mode changes without recreating textures
  useEffect(() => {
    requestRender();
  }, [activeFilmId, camera, sharpening,sharpeningMask,isSharpeningDragging,colorMixer, isColorMixerOpen, mixerVisualize, mixerPointId, curves, isToneCurveOpen, adjustments, compareMode, isPressHolding, splitPos, requestRender]);

  // Step zoom around center helper
  const zoomByStep = useCallback((factor: number) => {
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const nextZoom = Math.min(8.0, Math.max(1.0, currentZoom * factor));
    if (Math.abs(nextZoom - currentZoom) < 0.001) return;

    const ratio = nextZoom / currentZoom;
    const rawPanX = -ratio * -currentPan.x;
    const rawPanY = -ratio * -currentPan.y;

    const fw = fittedSizeRef.current.width;
    const fh = fittedSizeRef.current.height;
    const cw = containerSize.width;
    const ch = containerSize.height;

    const clamped = clampPan(
      { x: rawPanX, y: rawPanY },
      nextZoom,
      fw,
      fh,
      cw,
      ch
    );

    setZoomAndPan(nextZoom, clamped);
  }, [containerSize, setZoomAndPan]);

  // Native Wheel Listener for cursor-centered zooming
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !image) return;

    const handleWheelNative = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-photo-overlay]')) return;
      e.preventDefault();
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      const delta = -e.deltaY;
      const zoomSpeed = 0.002;
      const factor = Math.exp(delta * zoomSpeed);
      const nextZoom = Math.min(8.0, Math.max(1.0, currentZoom * factor));

      if (Math.abs(nextZoom - currentZoom) < 0.001) return;

      const rect = el.getBoundingClientRect();
      const viewportCenterX = rect.left + rect.width / 2;
      const viewportCenterY = rect.top + rect.height / 2;

      const cursorX = e.clientX - viewportCenterX;
      const cursorY = e.clientY - viewportCenterY;
      const ratio = nextZoom / currentZoom;

      const rawPanX = cursorX - ratio * (cursorX - currentPan.x);
      const rawPanY = cursorY - ratio * (cursorY - currentPan.y);

      const fw = fittedSizeRef.current.width;
      const fh = fittedSizeRef.current.height;

      const clamped = clampPan(
        { x: rawPanX, y: rawPanY },
        nextZoom,
        fw,
        fh,
        rect.width,
        rect.height
      );

      setZoomAndPan(nextZoom, clamped);
    };

    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheelNative);
    };
  }, [image, setZoomAndPan]);

  // Keyboard Shortcuts (F = Fit, 0 = Fit, + = Zoom In, - = Zoom Out)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (['INPUT', 'TEXTAREA'].includes(activeEl.tagName) ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if (e.key === 'f' || e.key === 'F' || e.key === '0') {
        e.preventDefault();
        resetZoomPan();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomByStep(1.25);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomByStep(0.8);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetZoomPan, zoomByStep]);

  // Pointer interactions for Split Divider
  const handleSplitPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingSplit(true);
  };

  const updateSplitFromClientX = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pos = (clientX - rect.left) / rect.width;
    setSplitPos(Math.min(0.99, Math.max(0.01, pos)));
  };

  // Pointer & Gesture Handling
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isDraggingSplit) return;

    if (e.pointerType === 'touch') {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activeTouchesRef.current.size === 1) {
        // Single touch: double tap detection
        const now = Date.now();
        if (now - lastTapTimeRef.current < 300) {
          lastTapTimeRef.current = 0;
          if (zoom > 1.05) {
            resetZoomPan();
          } else {
            // Moderate 2.5x zoom centered at tap position
            const container = containerRef.current;
            if (container) {
              const rect = container.getBoundingClientRect();
              const cx = e.clientX - (rect.left + rect.width / 2);
              const cy = e.clientY - (rect.top + rect.height / 2);
              const targetZoom = 2.5;
              const ratio = targetZoom / zoom;
              const rawPanX = cx - ratio * (cx - pan.x);
              const rawPanY = cy - ratio * (cy - pan.y);
              const clamped = clampPan(
                { x: rawPanX, y: rawPanY },
                targetZoom,
                displaySize.width,
                displaySize.height,
                containerSize.width,
                containerSize.height
              );
              setZoomAndPan(targetZoom, clamped);
            }
          }
          return;
        }
        lastTapTimeRef.current = now;

        if (zoom > 1.01) {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setIsPanning(true);
          panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        }
      } else if (activeTouchesRef.current.size === 2) {
        // Pinch zoom start
        const touches = Array.from(activeTouchesRef.current.values());
        const dist = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
        const midX = (touches[0].x + touches[1].x) / 2;
        const midY = (touches[0].y + touches[1].y) / 2;
        pinchStartRef.current = {
          dist,
          midX,
          midY,
          zoom,
          pan,
        };
        setIsPanning(false);
      }
    } else {
      // Mouse interaction: pan when zoomed in
      if (e.button === 0 && zoom > 1.01) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setIsPanning(true);
        panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingSplit) {
      updateSplitFromClientX(e.clientX);
      return;
    }

    if (e.pointerType === 'touch' && activeTouchesRef.current.has(e.pointerId)) {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activeTouchesRef.current.size === 2 && pinchStartRef.current) {
        const touches = Array.from(activeTouchesRef.current.values());
        const newDist = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
        const newMidX = (touches[0].x + touches[1].x) / 2;
        const newMidY = (touches[0].y + touches[1].y) / 2;
        const scale = newDist / pinchStartRef.current.dist;
        const targetZoom = Math.min(8.0, Math.max(1.0, pinchStartRef.current.zoom * scale));

        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const vcx = rect.left + rect.width / 2;
          const vcy = rect.top + rect.height / 2;
          const cursorX = newMidX - vcx;
          const cursorY = newMidY - vcy;
          const ratio = targetZoom / pinchStartRef.current.zoom;
          const rawPanX = cursorX - ratio * (cursorX - pinchStartRef.current.pan.x) + (newMidX - pinchStartRef.current.midX);
          const rawPanY = cursorY - ratio * (cursorY - pinchStartRef.current.pan.y) + (newMidY - pinchStartRef.current.midY);

          const clamped = clampPan(
            { x: rawPanX, y: rawPanY },
            targetZoom,
            displaySize.width,
            displaySize.height,
            containerSize.width,
            containerSize.height
          );
          setZoomAndPan(targetZoom, clamped);
        }
        return;
      }
    }

    if (isPanning) {
      const nextX = e.clientX - panStartRef.current.x;
      const nextY = e.clientY - panStartRef.current.y;
      const clamped = clampPan(
        { x: nextX, y: nextY },
        zoom,
        displaySize.width,
        displaySize.height,
        containerSize.width,
        containerSize.height
      );
      setPan(clamped);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      activeTouchesRef.current.delete(e.pointerId);
      if (activeTouchesRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      if (activeTouchesRef.current.size === 0) {
        setIsPanning(false);
        setIsDraggingSplit(false);
      }
    } else {
      setIsPanning(false);
      setIsDraggingSplit(false);
    }
  };

  const sampleMixerColor=(clientX:number,clientY:number):HSL|null=>{
    const canvas=canvasRef.current,renderer=rendererRef.current,state=useEditorStore.getState();
    if(!canvas||!renderer?.isReady()||lutFilmRef.current!==state.activeFilmId)return null;
    const rect=canvas.getBoundingClientRect(),u=(clientX-rect.left)/rect.width,v=(clientY-rect.top)/rect.height;
    if(u<0||u>1||v<0||v>1)return null;
    const x=Math.min(canvas.width-1,Math.floor(u*canvas.width)),y=Math.min(canvas.height-1,Math.floor(v*canvas.height));
    const options={sharpening:state.sharpening,sharpeningMask:state.sharpeningMask,sourceWidth:state.image?.originalWidth,sourceHeight:state.image?.originalHeight,adjustments:state.adjustments,camera:state.camera,curves:state.curves,colorMixer:state.colorMixer,filmId:state.activeFilmId,compareMode:compareModeRef.current,splitPos:splitPosRef.current,seed:42,mixerVisualize:visualizeRef.current};
    try{
      renderer.render({...options,compareMode:'none',mixerReference:true,mixerVisualize:null});
      const sx=Math.max(0,x-1),sy=Math.max(0,canvas.height-1-y-1),w=Math.min(3,canvas.width-sx),h=Math.min(3,canvas.height-sy);
      const pixels=renderer.readPixels(sx,sy,w,h);if(!pixels)return null;
      const rgb=[0,0,0];let count=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<128)continue;for(let c=0;c<3;c++)rgb[c]+=pixels[i+c]/255;count++;}
      return count?rgb.map(v=>v/count) as HSL:null;
    }finally{renderer.render(options);}
  };
  const applyTarget=(delta:number,commit:boolean,current=false)=>{
    const gesture=mixerGesture.current;if(!gesture)return;
    const state=useEditorStore.getState(),next=normalizeColorMixer(current?state.colorMixer:gesture.basis);
    next.enabled=true;
    MIXER_COLORS.forEach((c,i)=>{next.bands[c][gesture.axis]+=delta*gesture.weights[i];});
    state.setColorMixer(next,commit);
  };
  const mixerDown=(e:React.PointerEvent<HTMLDivElement>)=>{
    e.preventDefault();e.stopPropagation();if(mixerGesture.current?.pointerId!=null)return;
    const state=useEditorStore.getState(),rgb=sampleMixerColor(e.clientX,e.clientY);
    if(!rgb){state.setMixerUI({mixerMessage:'사진 안의 색을 선택하세요. 필터가 준비된 후 다시 시도할 수 있습니다.'});return;}
    const hsl=rgbToHsl(rgb);
    if(Math.max(...rgb)-Math.min(...rgb)<.01){state.setMixerUI({mixerMessage:'회색 영역입니다. 색이 있는 부분을 선택하세요.'});return;}
    if(state.mixerTool==='eyedropper'){
      if(state.colorMixer.points.length>=8)return;
      const next=normalizeColorMixer(state.colorMixer),p=pointFromColor(rgb,next.points.length);next.points.push(p);state.setColorMixer(next);state.setMixerUI({mixerPointId:p.id,mixerTool:'none',mixerMessage:''});return;
    }
    const weights=mixerBandWeights(hsl[0]);
    mixerGesture.current={pointerId:e.pointerId,y:e.clientY,basis:normalizeColorMixer(state.colorMixer),weights,axis:state.mixerAxis};
    state.setMixerUI({mixerColor:MIXER_COLORS[weights.indexOf(Math.max(...weights))],mixerMessage:`${state.mixerAxis} · ${MIXER_COLORS[weights.indexOf(Math.max(...weights))]}`});
    e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
  };
  const mixerMove=(e:React.PointerEvent)=>{e.stopPropagation();const g=mixerGesture.current;if(g?.pointerId===e.pointerId)applyTarget((g.y-e.clientY)*.5,false);};
  const commitMixerGesture=()=>{const state=useEditorStore.getState();state.setColorMixer(state.colorMixer);};
  const mixerUp=(e:React.PointerEvent)=>{e.stopPropagation();const g=mixerGesture.current;if(g?.pointerId!==e.pointerId)return;applyTarget((g.y-e.clientY)*.5,true);g.pointerId=null;};

  const baseFilm = FILM_PROFILES[activeFilmId];
  const preset = getMargarinePreset(activePresetId);
  const currentFilm = preset ? { ...baseFilm, name: preset.name, style: 'MARGARINE', id: 'MARGARINE' } : baseFilm;

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--ui-bg-08090d)] relative overflow-hidden select-none">
      {/* Canvas Viewport Area — PERSISTENT CONTAINER OBSERVED BY RESIZEOBSERVER */}
      <div
        ref={containerRef}
        data-testid="image-workspace"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`flex-1 min-w-0 min-h-0 relative flex items-center justify-center overflow-hidden ${
          !image
            ? ''
            : zoom > 1.01
            ? isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-default'
        }`}
      >
        {image&&<div aria-hidden="true" className="absolute inset-0 touch-none"/>}
        {!image ? (
          <ImageDropzone />
        ) : (
          <>
            {/* Render container with pan/zoom transform */}
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isPanning || isDraggingSplit || activeTouchesRef.current.size > 1 ? 'none' : 'transform 0.05s ease-out',
              }}
              className="relative flex items-center justify-center shadow-2xl flex-shrink-0 touch-none"
            >
              <canvas
                ref={handleCanvasRef}
                style={{
                  width: `${displaySize.width}px`,
                  height: `${displaySize.height}px`,
                }}
                className="rounded border border-[color:var(--ui-border-1e2430)] bg-[var(--ui-bg-11141a)] block shadow-lg"
              />

              {/* Interactive Split Divider Handle (placed over actual image display rect) */}
              {compareMode === 'split' && (
                <div
                  style={{ left: `${splitPos * 100}%` }}
                  onPointerDown={handleSplitPointerDown}
                  className="absolute top-0 bottom-0 w-8 -ml-4 flex items-center justify-center cursor-ew-resize z-20 group"
                >
                  <div className="w-[2px] h-full bg-white/95 shadow-[0_0_8px_rgba(0,0,0,0.8)] group-hover:bg-amber-400 transition-colors" />
                  <div className="w-6 h-6 rounded-full bg-[var(--ui-bg-12161f)] text-[color:var(--ui-text-amber-400)] shadow-xl flex items-center justify-center text-[10px] font-bold border border-amber-500/70 absolute group-hover:scale-115 transition-transform">
                    ↔
                  </div>
                </div>
              )}
            </div>

            {isColorMixerOpen&&mixerTool!=='none'&&<div data-testid="mixer-photo-tool" data-photo-overlay tabIndex={0} aria-label={mixerTool==='eyedropper'?'Pick a photo color':'Drag photo color to adjust'} className="absolute inset-0 z-10 cursor-crosshair touch-none outline-none" onPointerDown={mixerDown} onPointerMove={mixerMove} onPointerUp={mixerUp} onPointerCancel={e=>{e.stopPropagation();const g=mixerGesture.current;if(g?.pointerId===e.pointerId){commitMixerGesture();g.pointerId=null;}}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();applyTarget((e.key==='ArrowUp'?1:-1)*(e.shiftKey?10:1),true,true);}}}/>}
            <ColorMixerPanel />
            {sharpeningMask&&<button type="button" data-photo-overlay onClick={()=>useEditorStore.getState().setSharpeningMask(false)} className="absolute right-3 top-3 z-30 rounded border border-[color:var(--ui-border-slate500)] bg-[var(--ui-bg-111722)] px-2 py-1 text-xs text-[color:var(--ui-text-amber-300)]">마스크 보기 종료 ×</button>}
            <DetailLoupe />
            <>{isToneCurveOpen && <Histogram bins={histogram} />}</>
            <ToneCurveOverlay controlWidth={Math.max(32,Math.min(360,containerSize.width-24))} size={Math.max(32,Math.min(360,containerSize.width-24,containerSize.height-100,displaySize.width,displaySize.height))} />
            <CameraEffects />
            {/* Floating Active Film Tag */}
            <div className="absolute top-3 right-3 pointer-events-none flex items-center space-x-2 bg-[var(--ui-bg-12161f)]/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-[color:var(--ui-border-242b3b)] shadow-md z-10">
              <Sparkles className="w-3.5 h-3.5 text-[color:var(--ui-text-amber-400)]" />
              <span className="text-xs font-semibold text-[color:var(--ui-text-slate100)]">{currentFilm.name}</span>
              <span className="text-[10px] text-[color:var(--ui-text-slate400)] font-mono hidden sm:inline">({currentFilm.style})</span>
              <span className="text-[10px] text-[color:var(--ui-text-amber-400)] font-mono font-bold">
                {adjustments.filmStrength}%
              </span>
            </div>

            {/* Error overlay if any */}
            {rendererError && (
              <div className="absolute bottom-14 left-4 right-4 max-w-md mx-auto p-3 rounded-lg bg-red-950/90 border border-red-700 text-[color:var(--ui-text-red-200)] text-xs flex items-center gap-2 shadow-xl z-20">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{rendererError}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Responsive Status Bar */}
      {image && (
        <footer className="h-10 bg-[var(--ui-bg-0f1217)] border-t border-[color:var(--ui-border-1d222d)] px-3 sm:px-4 flex items-center justify-between z-10 flex-shrink-0 text-xs text-[color:var(--ui-text-slate400)] font-mono">
          {/* Left: Image Info */}
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            <span className="truncate max-w-[110px] sm:max-w-[200px] text-[color:var(--ui-text-slate300)] font-sans text-xs">
              {image.name}
            </span>
            <span className="text-[color:var(--ui-text-3b4455)] hidden sm:inline">|</span>
            <span className="hidden sm:inline">
              {image.originalWidth} × {image.originalHeight} px
            </span>
            <span className="text-[color:var(--ui-text-amber-500)]/90 text-[10px] hidden md:inline">sRGB</span>
          </div>

          {/* Center: Comparison Controls */}
          <div className="flex items-center space-x-1 bg-[var(--ui-bg-161a22)] p-0.5 rounded-lg border border-[color:var(--ui-border-222938)]">
            <button
              onClick={() => setCompareMode('none')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                compareMode === 'none' && !isPressHolding
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'text-[color:var(--ui-text-slate400)] hover:text-[color:var(--ui-text-slate200)]'
              }`}
            >
              Film
            </button>
            <button
              onClick={() => setCompareMode('split')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                compareMode === 'split'
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'text-[color:var(--ui-text-slate400)] hover:text-[color:var(--ui-text-slate200)]'
              }`}
            >
              <Columns className="w-3 h-3" /> Split
            </button>
            <button
              onPointerDown={() => setIsPressHolding(true)}
              onPointerUp={() => setIsPressHolding(false)}
              onPointerLeave={() => setIsPressHolding(false)}
              onPointerCancel={() => setIsPressHolding(false)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                isPressHolding || compareMode === 'original'
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'text-[color:var(--ui-text-slate400)] hover:text-[color:var(--ui-text-slate200)]'
              }`}
              title="Press and hold to view original"
            >
              <Eye className="w-3 h-3" /> Hold
            </button>
          </div>

          {/* Right: Zoom Controls */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => zoomByStep(0.8)}
              className="p-1.5 hover:text-[color:var(--ui-text-slate200)] transition-colors"
              title="Zoom Out (-)"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span
              className="w-12 text-center text-[11px] font-mono cursor-pointer hover:text-[color:var(--ui-text-amber-400)]"
              onClick={resetZoomPan}
              title="Click to reset Fit (100%)"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => zoomByStep(1.25)}
              className="p-1.5 hover:text-[color:var(--ui-text-slate200)] transition-colors"
              title="Zoom In (+)"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={resetZoomPan}
              className="p-1.5 hover:text-[color:var(--ui-text-slate200)] transition-colors hidden sm:inline-flex"
              title="Fit to Screen (F or 0)"
              aria-label="Fit to Screen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </footer>
      )}
    </main>
  );
};
