interface Props {
  bestScore: number;
  threshold: number;
  finishedScores: { index: number; score: number }[];
  passed: boolean;
  onTickClick: (iterationIndex: number) => void;
}

export function ScoreStrip({ bestScore, threshold, finishedScores, passed, onTickClick }: Props) {
  return (
    <div className="score-strip">
      <span className="label">Rubric score</span>
      <div className="score-track">
        <div
          className={`score-fill${passed ? " passed" : ""}`}
          style={{ width: `${bestScore * 100}%` }}
        />
        {finishedScores.map(({ index, score }) => (
          <div
            key={index}
            className="score-tick"
            style={{ left: `${score * 100}%` }}
            onClick={() => onTickClick(index)}
          >
            <div className="tip">
              iter {index} — {score.toFixed(2)}
            </div>
          </div>
        ))}
        <div className="score-threshold" style={{ left: `${threshold * 100}%` }}>
          <div className="tag">pass ≥ {threshold.toFixed(2)}</div>
        </div>
      </div>
      <span className="score-readout">
        {bestScore.toFixed(2)} <span className="thr">/ {threshold.toFixed(2)}</span>
      </span>
    </div>
  );
}
