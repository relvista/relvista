// @vitest-environment jsdom
// The MDX `code` wrapper: ```dbml fences become diagrams, everything else goes on unchanged.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DbmlFence from '../src/client/DbmlFence.js';
import { registerDbmlFence, type DbmlFenceProps } from '../src/client/fence.js';
import MDXCode from '../src/theme/MDXComponents/Code/index.js';

afterEach(cleanup);

describe('MDXComponents/Code', () => {
  it('turns a dbml fence into a diagram with its meta', async () => {
    // Nothing registered the fence component yet (a page the plugin's loader did not see): the
    // code block shows while it loads.
    render(
      <MDXCode className="language-dbml" metastring='title="Shop" height=300 source'>
        {'Table a {\n  id int\n}\n'}
      </MDXCode>,
    );
    expect(screen.getByTestId('mdx-code')).toBeTruthy();
    const d = await screen.findByTestId('diagram');
    expect(screen.queryByTestId('mdx-code')).toBeNull();
    expect(d.dataset['value']).toBe('Table a {\n  id int\n}');
    expect(d.dataset['title']).toBe('Shop');
    expect(d.dataset['height']).toBe('300');
    expect(d.dataset['source']).toBe('true');
  });

  it('passes every other fence, a static dbml fence and inline code to the original', () => {
    render(
      <>
        <MDXCode className="language-js">{'const a = 1;\n'}</MDXCode>
        <MDXCode className="language-dbml" metastring="static">
          {'Table a {\n}\n'}
        </MDXCode>
        <MDXCode>inline</MDXCode>
      </>,
    );
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(screen.getAllByTestId('mdx-code')).toHaveLength(3);
  });

  // Last: the registration stays for the rest of the file, as it does on a site.
  it('renders the fence component a page registered right away, without suspending', () => {
    const seen: DbmlFenceProps[] = [];
    registerDbmlFence((props) => {
      seen.push(props);
      return <DbmlFence {...props} />;
    });
    render(
      <>
        <MDXCode className="language-dbml" metastring="height=200">
          {'Table a {\n}\n'}
        </MDXCode>
        <MDXCode className="language-dbml" metastring="static">
          {'Table b {\n}\n'}
        </MDXCode>
        <MDXCode className="language-js">{'const a = 1;\n'}</MDXCode>
      </>,
    );
    expect(screen.getByTestId('diagram').dataset['height']).toBe('200');
    expect(screen.getAllByTestId('mdx-code')).toHaveLength(2);
    // Only the dbml fences reach it, with the site's code element for those that stay code.
    expect(seen.map((p) => p.metastring)).toEqual(['height=200', 'static']);
    expect(seen.every((p) => typeof p.original === 'function')).toBe(true);
  });
});
