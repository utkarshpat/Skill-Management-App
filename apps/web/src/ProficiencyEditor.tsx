import { isStandardFramework, standardLevels, type ProficiencyCriterion } from './proficiency';

export function ProficiencyEditor({
  levels,
  original,
  selected,
  onSelect,
  onChange,
  published,
}: {
  levels: ProficiencyCriterion[];
  original?: ProficiencyCriterion[];
  selected: number;
  onSelect: (index: number) => void;
  onChange: (levels: ProficiencyCriterion[]) => void;
  published: boolean;
}) {
  const index = Math.max(0, Math.min(selected, levels.length - 1)),
    level = levels[index];
  const needsAlignment = !isStandardFramework(levels);
  const stored = original ?? levels;
  return (
    <>
      <p className="access-help">
        Every skill uses the same five levels. Define what each level looks like for this skill.
      </p>
      <ol aria-label="Five-level proficiency model" className="proficiency-scale">
        {standardLevels().map(item => {
          const previous = stored.find(entry => entry.rank === item.rank);
          return (
            <li key={item.rank}>
              <span>Level {item.rank}</span>
              <strong>{item.name}</strong>
              {previous && previous.name !== item.name && <small>Saved: {previous.name}</small>}
            </li>
          );
        })}
      </ol>
      {needsAlignment ? (
        <div className="access-message" role="status">
          <p>
            This definition uses a previous framework. Align it before saving. Criteria at ranks 1–5
            are retained; missing criteria must be completed before publishing. Levels above 5 are
            removed from the new version only.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onChange(standardLevels(levels));
              onSelect(0);
            }}
          >
            Align to five levels
          </button>
        </div>
      ) : (
        original &&
        !isStandardFramework(original) && (
          <p className="access-help" role="status">
            Alignment is ready to save. Review the retained criteria below. Previous definitions and
            claim snapshots remain unchanged.
          </p>
        )
      )}
      <div className="level-selector">
        <label>
          Proficiency level
          <select value={index} onChange={event => onSelect(Number(event.target.value))}>
            {levels.map((item, i) => (
              <option key={i} value={i}>
                Level {item.rank} · {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {level && (
        <div role="group" aria-label={'Proficiency level ' + level.rank}>
          <h3>{level.name}</h3>
          <label>
            Criteria for {level.name}
            <textarea
              required={published}
              rows={4}
              maxLength={1000}
              value={level.description}
              onChange={event =>
                onChange(
                  levels.map((item, i) =>
                    i === index ? { ...item, description: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
        </div>
      )}
      <p className="access-help">
        Criteria are required for all five levels before publishing. Saving creates a new definition
        version, not a proficiency verification.
      </p>
    </>
  );
}
