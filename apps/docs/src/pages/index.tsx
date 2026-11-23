import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import CodeBlock from '@theme/CodeBlock';
import DbmlDiagram from '@theme/DbmlDiagram';
import Layout from '@theme/Layout';
import ThemedImage from '@theme/ThemedImage';
import { useEffect, useState, type ReactNode } from 'react';
import ecommerce from '@site/../../examples/02-ecommerce.dbml';
import styles from './index.module.css';

const FEATURES: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Plain DBML',
    body: (
      <>
        The same language as dbdiagram.io, parsed by <code>@dbml/parse</code>, Holistics&apos;
        open-source DBML parser. Files open there and here unchanged.
      </>
    ),
  },
  {
    title: 'A fence is enough',
    body: (
      <>
        Write a <code>```dbml</code> block in Markdown and get a diagram you can zoom, pan, search,
        open fullscreen, print and export as SVG or PNG, frozen the way you arranged it.
      </>
    ),
  },
  {
    title: 'Laid out for you',
    body: (
      <>
        ELK places tables and routes relationships to the exact columns. Keep hand-made positions in
        a small layout file next to your schema.
      </>
    ),
  },
  {
    title: 'Every DBML feature',
    body: (
      <>
        Table groups, header colours, sticky notes, partials, enums, notes, multi-file projects and
        <code>DiagramView</code>s all render.
      </>
    ),
  },
];

const FENCE = `\`\`\`dbml title="Blog" height=320
Table users {
  id integer [pk]
  email varchar [unique]
}

Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar
}
\`\`\``;

const BLOG = `Table users {
  id integer [pk]
  email varchar [unique]
}

Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar
}`;

/** A link that opens `source` in the editor (share hash built in the browser, codec loaded lazily). */
function EditInEditor({ source, children }: { source: string; children: ReactNode }): ReactNode {
  const editorUrl = useBaseUrl('/editor/');
  const [href, setHref] = useState(editorUrl);
  useEffect(() => {
    let alive = true;
    void import(/* webpackChunkName: "relvista-viewer" */ '@relvista/renderer').then(
      async ({ createEditorLink }) => {
        const link = await createEditorLink(editorUrl, { dbml: source });
        if (alive) setHref(link);
      },
    );
    return () => {
      alive = false;
    };
  }, [editorUrl, source]);
  return (
    <a className="button button--link" href={href} data-testid="edit-in-editor">
      {children}
    </a>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="DBML diagrams for your docs"
      description="relvista renders DBML as interactive ER diagrams in Docusaurus: zoom, pan, fullscreen, print and export."
    >
      <header className={styles.hero}>
        <div className="container">
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Open source · MIT libraries · AGPL editor</p>
            <h1 className={styles.title}>
              <ThemedImage
                className={styles.lockup}
                alt={siteConfig.title}
                sources={{
                  light: useBaseUrl('/img/logo-light.svg'),
                  dark: useBaseUrl('/img/logo-dark.svg'),
                }}
                width={536}
                height={120}
              />
            </h1>
            <p className={styles.tagline}>{siteConfig.tagline}</p>
            <p className={styles.lead}>
              Turn <a href="https://dbml.dbdiagram.io/docs/">DBML</a> schemas into interactive
              entity-relationship diagrams: edit them in the browser with a live diagram, or render
              them inside Docusaurus. No account, no server, no screenshots that go stale.
            </p>
            <div className={styles.buttons}>
              <Link
                className="button button--primary button--lg"
                to="pathname:///editor/"
                target="_self"
              >
                Open the editor
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/getting-started">
                Get started
              </Link>
              <Link className="button button--link button--lg" to="/docs/gallery">
                Browse the gallery →
              </Link>
            </div>
            <div className={styles.install}>
              <code>npm i @relvista/docusaurus-plugin</code>
            </div>
          </div>
          <div className={styles.heroDiagram}>
            <DbmlDiagram value={ecommerce} title="storefront · 02-ecommerce.dbml" height={560} />
          </div>
          <p className={styles.heroHint}>
            Live diagram: hover to trace relationships, click a table for details, unlock the layout
            in the toolbar to drag tables, try fullscreen and export.
          </p>
        </div>
      </header>

      <main>
        <section className={styles.features}>
          <div className="container">
            <div className={styles.featureGrid}>
              {FEATURES.map((f) => (
                <div key={f.title} className={styles.feature}>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.how}>
          <div className="container">
            <h2 className={styles.sectionTitle}>From a code fence to a diagram</h2>
            <div className={styles.howGrid}>
              <div className={styles.howCode}>
                <p className={styles.howLabel}>You write</p>
                <CodeBlock language="md" title="docs/schema.md">
                  {FENCE}
                </CodeBlock>
              </div>
              <div className={styles.howResult}>
                <p className={styles.howLabel}>Readers get</p>
                <DbmlDiagram value={BLOG} title="Blog" height={320} />
              </div>
            </div>
            <div className={styles.cta}>
              <Link className="button button--primary" to="/docs/getting-started">
                Add it to your site
              </Link>
              <EditInEditor source={BLOG}>Edit this example in the editor</EditInEditor>
              <Link className="button button--link" to="/docs/usage">
                All options →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
