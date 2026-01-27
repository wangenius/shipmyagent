"use client";
import Image from "next/image";
import { useState } from "react";

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
  placeholder = "empty",
  blurDataURL,
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-fd-muted text-fd-muted-foreground ${className}`}
        style={{ width, height }}
      >
        <span className="text-sm">Image failed to load</span>
      </div>
    );
  }

  return (
    <div
      className={`relative ${
        isLoading ? "animate-pulse bg-fd-muted" : ""
      } ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        placeholder={placeholder}
        blurDataURL={blurDataURL}
        className={`transition-opacity duration-300 ${
          isLoading ? "opacity-0" : "opacity-100"
        }`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        // Optimize for performance
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        quality={85}
      />
    </div>
  );
}

// Logo component with proper sizing and alt text
export function Logo({
  size = 24,
  className = "",
  showText = true,
}: {
  size?: number;
  className?: string;
  showText?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <OptimizedImage
        src="/logo.png"
        alt="shipmyagent"
        width={size}
        height={size}
        priority={true}
        className="rounded"
      />
      {showText && (
        <span className="font-semibold text-fd-foreground">shipmyagent</span>
      )}
    </div>
  );
}

// Icon component for documentation
export function DocIcon({
  type,
  size = 20,
}: {
  type: "hero" | "room" | "shot" | "codex" | "guide" | "api" | "example";
  size?: number;
}) {
  const icons = {
    hero: "🤖",
    room: "🏠",
    shot: "💬",
    codex: "📖",
    guide: "📚",
    api: "⚡",
    example: "💡",
  };

  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-fd-muted text-fd-muted-foreground"
      style={{
        width: size + 8,
        height: size + 8,
        fontSize: size * 0.6,
      }}
      role="img"
      aria-label={`${type} icon`}
    >
      {icons[type]}
    </span>
  );
}

// Placeholder for missing images
export function ImagePlaceholder({
  width,
  height,
  text = "Image",
  className = "",
}: {
  width: number;
  height: number;
  text?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center bg-fd-muted text-fd-muted-foreground border border-fd-border rounded ${className}`}
      style={{ width, height }}
    >
      <div className="text-center">
        <div className="text-2xl mb-1">🖼️</div>
        <div className="text-xs">{text}</div>
      </div>
    </div>
  );
}
