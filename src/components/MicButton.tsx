interface MicButtonProps {
  supported: boolean;
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function MicButton({ supported, listening, onStart, onStop }: MicButtonProps) {
  return (
    <button
      type="button"
      className={`mic ${listening ? 'mic-live' : ''}`}
      onClick={listening ? onStop : onStart}
      disabled={!supported}
      title={supported ? (listening ? 'Stop listening' : 'Start listening') : 'Web Speech API unavailable in this browser'}
    >
      <span className="mic-dot" />
      {listening ? 'Listening… tap to stop' : 'Speak'}
    </button>
  );
}
