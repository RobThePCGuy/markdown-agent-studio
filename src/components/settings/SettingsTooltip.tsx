import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './SettingsTooltip.module.css';

interface SettingsTooltipProps {
  /** Full description text to reveal with typewriter effect. */
  text: string;
  /** Characters per second for the typewriter (default 120). */
  speed?: number;
}

/**
 * A small "?" icon that, on hover, shows an animated tooltip bubble
 * with a fast typewriter text reveal and blinking cursor.
 */
export default function SettingsTooltip({ text, speed = 120 }: SettingsTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [displayed, setDisplayed] = useState('');
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  // Delay before showing (avoids flicker on accidental hovers)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    showTimer.current = setTimeout(() => setVisible(true), 180);
  }, []);

  const handleLeave = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setVisible(false);
  }, []);

  // Typewriter animation driven by requestAnimationFrame
  useEffect(() => {
    if (!visible) {
      setDisplayed('');
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    startRef.current = performance.now();
    const msPerChar = 1000 / speed;

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const charCount = Math.min(Math.floor(elapsed / msPerChar), text.length);
      setDisplayed(text.slice(0, charCount));

      if (charCount < text.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, text, speed]);

  const done = displayed.length === text.length;

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span className={styles.icon}>?</span>

      {visible && (
        <span className={styles.bubble}>
          <span className={styles.arrow} />
          <span className={styles.arrowInner} />
          <p className={styles.text}>
            {displayed}
            {!done && <span className={styles.cursor} />}
          </p>
        </span>
      )}
    </span>
  );
}
