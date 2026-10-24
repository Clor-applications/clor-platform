import React from 'react';

/**
 * A product illustration. Width and height are the file's own, so the page
 * keeps its place while the image loads; everything below the first screen
 * loads lazily. `alt=""` marks one as decoration beside text that already
 * says the same.
 */
export default function Illustration({ src, width, height, alt, className = '', priority = false }) {
  return (
    <figure className={`illus ${className}`.trim()}>
      <img
        src={src}
        width={width}
        height={height}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : undefined}
      />
    </figure>
  );
}
