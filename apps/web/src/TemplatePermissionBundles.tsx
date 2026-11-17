import { useState } from 'react';
import { PermissionEditor } from './PermissionEditor';
import {
  availableBundles,
  bundleSelected,
  toggleBundle,
  type PermissionMetadata,
  type TemplatePermission,
} from './template-permission-bundles';

export function TemplatePermissionBundles({
  value,
  onChange,
  catalogue,
}: {
  value: TemplatePermission[];
  onChange: (value: TemplatePermission[]) => void;
  catalogue: PermissionMetadata[];
}) {
  const [advanced, setAdvanced] = useState(value.length > 0);
  const bundles = availableBundles(catalogue);
  return (
    <>
      {bundles.length > 0 && (
        <fieldset className="template-bundle-picker">
          <legend>Permission bundles</legend>
          <div className="template-card-grid">
            {bundles.map(bundle => (
              <label className="template-bundle-card" key={bundle.id}>
                <input
                  type="checkbox"
                  aria-label={bundle.name + ' bundle'}
                  checked={bundleSelected(value, bundle.permissions)}
                  onChange={event =>
                    onChange(toggleBundle(value, bundle.permissions, event.target.checked))
                  }
                />
                <span>
                  <strong>{bundle.name}</strong>
                  <small>{bundle.description}</small>
                  <small>{bundle.permissions.length} permissions</small>
                </span>
              </label>
            ))}
          </div>
          <p className="template-note">
            Existing blocks and expiring grants are retained. Review individual permissions to
            change them.
          </p>
        </fieldset>
      )}
      <button
        type="button"
        className="secondary-button"
        aria-expanded={advanced}
        onClick={() => setAdvanced(previous => !previous)}
      >
        {advanced ? 'Hide individual permissions' : 'Customize individual permissions'}
      </button>
      {advanced && (
        <PermissionEditor
          label="Template permissions"
          value={value}
          onChange={onChange}
          catalogue={catalogue}
        />
      )}
    </>
  );
}
