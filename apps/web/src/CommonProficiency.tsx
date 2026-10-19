import { commonLevels } from './proficiency';

export function CommonProficiency() {
  return (
    <section className="catalogue-framework" aria-label="Common proficiency framework">
      <h3>One proficiency framework for every skill</h3>
      <p>
        Employees choose their level when claiming a skill. These criteria are shared and cannot be
        edited here.
      </p>
      <div className="catalogue-framework-grid">
        {commonLevels().map(level => (
          <article key={level.rank}>
            <span className="catalogue-level">L{level.rank}</span>
            <h4>{level.name}</h4>
            <p>{level.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
