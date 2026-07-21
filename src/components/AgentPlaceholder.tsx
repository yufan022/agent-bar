interface Props {
  name: string;
}

export function AgentPlaceholder({ name }: Props) {
  return (
    <section className="card placeholder-card">
      <header className="card-header">
        <div>
          <h2>{name}</h2>
          <p className="muted">Quota tracking</p>
        </div>
        <span className="soon-pill">Coming soon</span>
      </header>
      <p className="muted placeholder-copy">
        This agent will appear here once its usage API integration lands.
      </p>
    </section>
  );
}
