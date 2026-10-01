import { useState } from "react";
import { slugify } from "../../lib/admin/contentAdapters";
import { mediaSummaryFromPhotos } from "../../lib/admin/photographyTemplates";
import {
  AUDIENCE_LEVELS,
  createFaceBlock,
  createLocalId,
  createMediaValue,
  DISPATCH_TYPES,
  PAPER_AUDIENCES,
  PHOTO_TEMPLATES,
  QUOTE_STYLES,
} from "../../lib/admin/schemas";
import { swapCoordinateValues, validateCoordinates } from "../../lib/admin/coordinates";
import { AssetField, DOCUMENT_ACCEPT, IMAGE_ACCEPT, MultiUploadZone } from "./AssetUpload";
import { Section, SelectField, TextArea, TextInput, ToggleField, copyText } from "./ui";

const TRAVEL_QUOTE_MAX_CHARS = 220;
const base = import.meta.env.BASE_URL ?? "/";
const basePath = base.endsWith("/") ? base : `${base}/`;

function isEmptyMedia(item) {
  return !item || !item.url;
}

// Appends uploaded assets into a list of media slots, filling empty slots first.
function mergeIntoSlots(items, assets) {
  const next = [...(items || [])];
  assets.forEach((asset) => {
    const emptyIndex = next.findIndex(isEmptyMedia);
    if (emptyIndex >= 0) next[emptyIndex] = asset;
    else next.push(asset);
  });
  return next;
}

function reorder(list, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function CoordinateNotice({ longitude, latitude, onSwap }) {
  const state = validateCoordinates(longitude, latitude);
  if (!state.message) return null;
  return (
    <div className={`admin-notice admin-notice-${state.looksSwapped ? "warning" : "info"}`}>
      <span>{state.message}</span>
      {state.looksSwapped ? (
        <button type="button" className="admin-mini-button" onClick={onSwap}>
          Swap coordinates
        </button>
      ) : null}
    </div>
  );
}

export function StringListEditor({ label, hint, values, onChange, addLabel = "Add item" }) {
  return (
    <Section
      title={label}
      description={hint}
      actions={<button type="button" className="admin-mini-button" onClick={() => onChange([...(values || []), ""])}>{addLabel}</button>}
    >
      <div className="admin-stack tight">
        {(values || []).map((value, index) => (
          <div className="admin-inline-row" key={`${label}-${index}`}>
            <input
              className="admin-input"
              value={value || ""}
              onChange={(event) => {
                const next = [...(values || [])];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              className="admin-icon-button"
              onClick={() => {
                const next = (values || []).filter((_, itemIndex) => itemIndex !== index);
                onChange(next.length ? next : [""]);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CoordinateFields({ draft, onChange }) {
  const coordinates = validateCoordinates(draft.longitude, draft.latitude);
  return (
    <>
      <div className="admin-grid two-up">
        <TextInput label="Longitude" value={draft.longitude} onChange={(next) => onChange({ ...draft, longitude: next })} />
        <TextInput label="Latitude" value={draft.latitude} onChange={(next) => onChange({ ...draft, latitude: next })} />
      </div>
      <CoordinateNotice
        longitude={draft.longitude}
        latitude={draft.latitude}
        onSwap={() => onChange({ ...draft, ...swapCoordinateValues(draft.longitude, draft.latitude) })}
      />
      {coordinates.isValid ? <p className="admin-field-hint">Pin location confirmed: {coordinates.longitude}, {coordinates.latitude}</p> : null}
    </>
  );
}

function ItemCard({ title, onUp, onDown, onRemove, disableUp, disableDown, children }) {
  return (
    <article className="admin-subcard">
      <div className="admin-subcard-head">
        <strong>{title}</strong>
        <div className="admin-button-row compact">
          {onUp ? <button type="button" className="admin-mini-button" disabled={disableUp} onClick={onUp} aria-label="Move up">&uarr;</button> : null}
          {onDown ? <button type="button" className="admin-mini-button" disabled={disableDown} onClick={onDown} aria-label="Move down">&darr;</button> : null}
          <button type="button" className="admin-mini-button danger" onClick={onRemove}>Remove</button>
        </div>
      </div>
      {children}
    </article>
  );
}

function FaceBlocksEditor({ blocks, onChange, onUpload, assets }) {
  function updateBlock(index, nextBlock) {
    const next = [...blocks];
    next[index] = nextBlock;
    onChange(next);
  }
  return (
    <Section
      title="Story"
      description="Build the profile body from paragraphs, Q&A, pull quotes and photos."
      actions={(
        <>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("paragraph")])}>+ Paragraph</button>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("qa")])}>+ Q&amp;A</button>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("quote")])}>+ Quote</button>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("photo")])}>+ Photo</button>
        </>
      )}
    >
      <div className="admin-stack">
        {(blocks || []).map((block, index) => (
          <ItemCard
            key={block.id || index}
            title={{ paragraph: "Paragraph", qa: "Question & answer", quote: "Pull quote", photo: "Photo" }[block.type] || block.type}
            onUp={() => onChange(reorder(blocks, index, -1))}
            onDown={() => onChange(reorder(blocks, index, 1))}
            disableUp={index === 0}
            disableDown={index === blocks.length - 1}
            onRemove={() => onChange(blocks.filter((_, itemIndex) => itemIndex !== index))}
          >
            {block.type === "paragraph" ? <TextArea label="Text" value={block.text} onChange={(next) => updateBlock(index, { ...block, text: next })} rows={5} /> : null}
            {block.type === "quote" ? <TextArea label="Quote" value={block.text} onChange={(next) => updateBlock(index, { ...block, text: next })} rows={3} /> : null}
            {block.type === "qa" ? (
              <div className="admin-stack tight">
                <TextArea label="Question" value={block.question} onChange={(next) => updateBlock(index, { ...block, question: next })} rows={2} />
                <TextArea label="Answer" value={block.answer} onChange={(next) => updateBlock(index, { ...block, answer: next })} rows={5} />
              </div>
            ) : null}
            {block.type === "photo" ? (
              <AssetField label="Photo" accept={IMAGE_ACCEPT} value={block} assets={assets} onUpload={onUpload} onChange={(next) => updateBlock(index, { ...block, ...next })} kind="faces" field={`block-${index}`} compact />
            ) : null}
          </ItemCard>
        ))}
        {!(blocks || []).length ? <p className="admin-empty-inline">No story blocks yet. Add a paragraph to begin.</p> : null}
      </div>
    </Section>
  );
}

function GalleryEditor({ label, description, items, onChange, onUpload, assets, kind }) {
  const list = items || [];
  return (
    <Section
      title={label}
      description={description || "Drop several photos at once, then reorder them."}
      actions={<button type="button" className="admin-mini-button" onClick={() => onChange([...list, createMediaValue()])}>Add empty slot</button>}
    >
      <MultiUploadZone kind={kind} field={`${kind}-gallery`} onUpload={onUpload} onAssets={(newAssets) => onChange(mergeIntoSlots(list, newAssets))} />
      <div className="admin-stack">
        {list.map((item, index) => (
          <ItemCard
            key={`${label}-${index}`}
            title={`Photo ${index + 1}`}
            onUp={() => onChange(reorder(list, index, -1))}
            onDown={() => onChange(reorder(list, index, 1))}
            disableUp={index === 0}
            disableDown={index === list.length - 1}
            onRemove={() => onChange(list.filter((_, itemIndex) => itemIndex !== index))}
          >
            <AssetField
              label="Image"
              accept={IMAGE_ACCEPT}
              value={item}
              assets={assets}
              onUpload={onUpload}
              onChange={(next) => onChange(list.map((entry, entryIndex) => (entryIndex === index ? next : entry)))}
              kind={kind}
              field={`${kind}-gallery-${index}`}
              compact
            />
          </ItemCard>
        ))}
      </div>
    </Section>
  );
}

export function FacesForm({ draft, onChange, onUpload, assets }) {
  return (
    <div className="admin-form-stack">
      <Section title="Profile" description="Who this story is about.">
        <div className="admin-grid two-up">
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Subtitle" value={draft.subtitle} onChange={(next) => onChange({ ...draft, subtitle: next })} />
          <TextInput
            label="Person's name"
            hint="Shown on the card and the story."
            value={draft.profileName}
            onChange={(next) => onChange({ ...draft, profileName: next, slug: draft.slug || slugify(next) })}
          />
          <TextInput label="Descriptor" value={draft.descriptor} onChange={(next) => onChange({ ...draft, descriptor: next })} />
          <TextInput label="Age" value={draft.age} onChange={(next) => onChange({ ...draft, age: next })} />
          <TextInput label="Occupation" value={draft.occupation} onChange={(next) => onChange({ ...draft, occupation: next })} />
          <TextInput label="Religion" value={draft.religion} onChange={(next) => onChange({ ...draft, religion: next })} />
          <TextInput label="Date met" type="date" value={draft.publishDate} onChange={(next) => onChange({ ...draft, publishDate: next })} />
        </div>
        <TextArea label="Excerpt" hint="A short teaser shown on the card." value={draft.excerpt} onChange={(next) => onChange({ ...draft, excerpt: next })} rows={3} />
      </Section>

      <Section title="Location" description="Places the pin on the Faces map.">
        <div className="admin-grid two-up">
          <TextInput label="Place" value={draft.locationName} onChange={(next) => onChange({ ...draft, locationName: next })} />
          <TextInput label="Country / region" value={draft.countryRegion} onChange={(next) => onChange({ ...draft, countryRegion: next })} />
        </div>
        <CoordinateFields draft={draft} onChange={onChange} />
      </Section>

      <Section title="Photos" description="Upload from your computer.">
        <AssetField label="Portrait" accept={IMAGE_ACCEPT} value={draft.portrait} assets={assets} onUpload={onUpload} onChange={(next) => onChange({ ...draft, portrait: next })} kind="faces" field="portrait" hint="Shown on the card and at the top of the profile." />
        <AssetField label="Hero photo" accept={IMAGE_ACCEPT} value={draft.hero} assets={assets} onUpload={onUpload} onChange={(next) => onChange({ ...draft, hero: next })} kind="faces" field="hero" hint="Used for email art direction." />
      </Section>

      <FaceBlocksEditor blocks={draft.bodyBlocks || []} onChange={(next) => onChange({ ...draft, bodyBlocks: next })} onUpload={onUpload} assets={assets} />
      <GalleryEditor label="Gallery" items={draft.gallery || []} onChange={(next) => onChange({ ...draft, gallery: next })} onUpload={onUpload} assets={assets} kind="faces" />
      <StringListEditor label="Quick facts" hint="Short callouts shown with the profile." values={draft.facts || []} onChange={(next) => onChange({ ...draft, facts: next })} addLabel="Add fact" />

      <Section
        title="Featured quotes"
        actions={<button type="button" className="admin-mini-button" onClick={() => onChange({ ...draft, quotes: [...(draft.quotes || []), { id: createLocalId("face-quote"), text: "", style: "pull" }] })}>Add quote</button>}
      >
        <div className="admin-stack">
          {(draft.quotes || []).map((quote, index) => (
            <ItemCard key={quote.id} title={`Quote ${index + 1}`} onRemove={() => onChange({ ...draft, quotes: draft.quotes.filter((item) => item.id !== quote.id) })}>
              <div className="admin-grid two-up">
                <SelectField label="Style" value={quote.style} onChange={(next) => onChange({ ...draft, quotes: draft.quotes.map((item) => item.id === quote.id ? { ...item, style: next } : item) })} options={QUOTE_STYLES} />
                <TextArea label="Quote" value={quote.text} onChange={(next) => onChange({ ...draft, quotes: draft.quotes.map((item) => item.id === quote.id ? { ...item, text: next } : item) })} rows={3} />
              </div>
            </ItemCard>
          ))}
        </div>
      </Section>

      <Section title="Advanced" collapsible defaultOpen={false}>
        <TextInput label="Link name (slug)" hint="Part of the story's web address, e.g. marrakesh-at-dawn. Set automatically from the name." value={draft.slug} onChange={(next) => onChange({ ...draft, slug: slugify(next) })} />
      </Section>
    </div>
  );
}

function ProtectedShareLink({ draft, onRotate }) {
  const [copied, setCopied] = useState(false);
  const live = draft.status === "published" && draft.shareKey && (draft.slug || draft.id);
  const url = live
    ? `${window.location.origin}${basePath}selected-papers/${draft.audience}/?paper=${encodeURIComponent(draft.slug || draft.id)}&key=${encodeURIComponent(draft.shareKey)}`
    : "";
  return (
    <Section title="Private share link" description="Anyone with this link opens this one piece directly, with no invite code. They cannot see anything else.">
      {live ? (
        <>
          <input className="admin-input" readOnly value={url} onFocus={(event) => event.target.select()} />
          <div className="admin-inline-actions">
            <button type="button" className="admin-mini-button primary" onClick={() => copyText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}>{copied ? "Copied" : "Copy link"}</button>
            <button type="button" className="admin-mini-button danger" onClick={onRotate}>Reset link</button>
          </div>
        </>
      ) : <p className="admin-empty-inline">Publish this piece to generate its share link.</p>}
    </Section>
  );
}

export function PapersForm({ draft, onChange, onUpload, assets, paperTypeOptions, onRotateShareKey }) {
  const isProtected = draft.audience === "drafts" || draft.audience === "unpublished";
  return (
    <div className="admin-form-stack">
      <Section title="Details" description="Only pieces that are Live and set to Public appear on the Selected Papers page.">
        <div className="admin-grid two-up">
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Subtitle" value={draft.subtitle} onChange={(next) => onChange({ ...draft, subtitle: next })} />
          <SelectField label="Type" value={draft.type} onChange={(next) => onChange({ ...draft, type: next })} options={paperTypeOptions} />
          <TextInput label="Publish date" type="date" value={draft.publishDate} onChange={(next) => onChange({ ...draft, publishDate: next })} />
          <TextInput label="Publication name" hint="If it ran somewhere else." value={draft.publicationName} onChange={(next) => onChange({ ...draft, publicationName: next })} />
          <TextInput label="Publication link" hint="A link to the external article." value={draft.publicationLink} onChange={(next) => onChange({ ...draft, publicationLink: next })} />
          <TextInput label="Read time" placeholder="6 min" value={draft.readTime} onChange={(next) => onChange({ ...draft, readTime: next })} />
        </div>
        <div className="admin-grid two-up toggles">
          <ToggleField label="Featured paper" checked={draft.featured} onChange={(next) => onChange({ ...draft, featured: next })} />
          <ToggleField label="Published externally" checked={draft.externalPublication} onChange={(next) => onChange({ ...draft, externalPublication: next })} />
        </div>
      </Section>

      <Section title="Visibility" description="Drafts and Unpublished Thoughts are hidden behind the invite-code gate and never listed publicly.">
        <SelectField label="Where it appears" hint="After changing this on a live piece, unpublish and publish again." value={draft.audience || "public"} onChange={(next) => onChange({ ...draft, audience: next })} options={PAPER_AUDIENCES} />
      </Section>

      {isProtected ? <ProtectedShareLink draft={draft} onRotate={onRotateShareKey} /> : null}

      <Section title="Writing">
        <TextArea label="Summary" value={draft.summary} onChange={(next) => onChange({ ...draft, summary: next })} rows={4} />
        <TextArea label="Body / abstract" value={draft.bodyText} onChange={(next) => onChange({ ...draft, bodyText: next })} rows={12} />
      </Section>

      <Section title="Document" description="Upload the PDF or Word file readers can open.">
        <AssetField label="Document" accept={DOCUMENT_ACCEPT} value={draft.document} assets={assets} onUpload={onUpload} onChange={(next) => onChange({ ...draft, document: next })} kind="papers" field="document" compact />
      </Section>

      <StringListEditor label="Keywords" values={draft.keywords || []} onChange={(next) => onChange({ ...draft, keywords: next })} addLabel="Add keyword" />

      <Section title="Advanced" collapsible defaultOpen={false}>
        <div className="admin-grid two-up">
          <TextInput label="Link name (slug)" hint="Part of the piece's web address. Set automatically from the title." value={draft.slug} onChange={(next) => onChange({ ...draft, slug: slugify(next) })} />
          <TextInput label="Badge text" hint="e.g. Published" value={draft.badgeStyle} onChange={(next) => onChange({ ...draft, badgeStyle: next })} />
          <TextInput label="Display date override" hint="Replaces the date shown on the card." value={draft.customDisplayDate} onChange={(next) => onChange({ ...draft, customDisplayDate: next })} />
          <TextInput label="Featured rank" hint="Lower numbers appear first." value={draft.featuredRank} onChange={(next) => onChange({ ...draft, featuredRank: next })} />
        </div>
      </Section>
    </div>
  );
}

export function TravelForm({ draft, onChange, onUpload, assets }) {
  return (
    <div className="admin-form-stack">
      <Section title="Dispatch" description="Publishes into the Travel Dispatches feed.">
        <div className="admin-grid two-up">
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Publish date" type="date" value={draft.publishDate} onChange={(next) => onChange({ ...draft, publishDate: next })} />
          <SelectField label="Type" value={draft.dispatchType} onChange={(next) => onChange({ ...draft, dispatchType: next })} options={DISPATCH_TYPES} />
          <SelectField label="Audience level" value={draft.audienceLevel} onChange={(next) => onChange({ ...draft, audienceLevel: next })} options={AUDIENCE_LEVELS} />
          <TextInput label="Time label" hint="Optional, e.g. Dawn, 6:40 AM, Late Night." value={draft.timeLabel} onChange={(next) => onChange({ ...draft, timeLabel: next })} />
        </div>
        <ToggleField label="Pin as featured dispatch" checked={draft.pinned} onChange={(next) => onChange({ ...draft, pinned: next })} hint="Pinned dispatches appear first." />
      </Section>

      <Section title="Location" description="Places the pin on the globe.">
        <TextInput label="Place" value={draft.locationName} onChange={(next) => onChange({ ...draft, locationName: next })} />
        <CoordinateFields draft={draft} onChange={onChange} />
      </Section>

      <Section title="Writing">
        <TextArea label="Excerpt / preview" value={draft.excerpt} onChange={(next) => onChange({ ...draft, excerpt: next })} rows={3} />
        <TextArea label="Body" value={draft.bodyText} onChange={(next) => onChange({ ...draft, bodyText: next })} rows={12} />
      </Section>

      <GalleryEditor label="Photos" items={draft.photos || []} onChange={(next) => onChange({ ...draft, photos: next })} onUpload={onUpload} assets={assets} kind="travel" />

      <Section
        title="Quote cards"
        description={`Short pull quotes shown beside the dispatch. Up to ${TRAVEL_QUOTE_MAX_CHARS} characters each.`}
        actions={<button type="button" className="admin-mini-button" onClick={() => onChange({ ...draft, quotes: [...(draft.quotes || []), { id: createLocalId("travel-quote"), text: "" }] })}>Add quote</button>}
      >
        <div className="admin-stack tight">
          {(draft.quotes || []).map((quote) => (
            <div className="admin-inline-row" key={quote.id}>
              <div className="admin-field">
                <textarea
                  className="admin-textarea"
                  rows={3}
                  maxLength={TRAVEL_QUOTE_MAX_CHARS}
                  value={quote.text || ""}
                  onChange={(event) => onChange({
                    ...draft,
                    quotes: draft.quotes.map((item) => item.id === quote.id ? { ...item, text: String(event.target.value || "").slice(0, TRAVEL_QUOTE_MAX_CHARS) } : item),
                  })}
                />
                <span className="admin-field-hint">{String((quote.text || "").length)}/{TRAVEL_QUOTE_MAX_CHARS}</span>
              </div>
              <button type="button" className="admin-icon-button" onClick={() => onChange({ ...draft, quotes: draft.quotes.filter((item) => item.id !== quote.id) })}>Remove</button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Advanced" collapsible defaultOpen={false}>
        <TextInput label="Link name (slug)" hint="Part of the dispatch's web address. Set automatically from the title." value={draft.slug} onChange={(next) => onChange({ ...draft, slug: slugify(next) })} />
      </Section>
    </div>
  );
}

export function PhotographyForm({ draft, onChange, onUpload, assets }) {
  const photos = Array.isArray(draft.photos) ? draft.photos : [];
  const summary = mediaSummaryFromPhotos(photos);
  const themeValue = String(draft.theme || draft.template || PHOTO_TEMPLATES[0]?.value || "desert-bloom");

  function updatePhoto(index, nextPhoto) {
    const next = [...photos];
    next[index] = nextPhoto;
    onChange({ ...draft, photos: next });
  }

  function removePhoto(index) {
    const next = photos.filter((_, itemIndex) => itemIndex !== index);
    onChange({ ...draft, photos: next.length ? next : [createMediaValue()] });
  }

  return (
    <div className="admin-form-stack">
      <Section title="Shoot" description="The essentials for this photo story.">
        <div className="admin-grid two-up">
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Location (city, country)" value={draft.locationLabel || ""} onChange={(next) => onChange({ ...draft, locationLabel: next })} />
          <TextInput label="Date" type="date" value={draft.shootDate} onChange={(next) => onChange({ ...draft, shootDate: next })} />
          <SelectField label="Layout" hint="How the shoot is arranged on the page." value={themeValue} onChange={(next) => onChange({ ...draft, theme: next, template: next })} options={PHOTO_TEMPLATES} />
        </div>
        <label className="admin-field admin-color-field">
          <span className="admin-field-label">Accent color</span>
          <span className="admin-color-row">
            <input type="color" value={draft.accentColor || "#c96b28"} onChange={(event) => onChange({ ...draft, accentColor: event.target.value })} />
            <code>{draft.accentColor || "#c96b28"}</code>
          </span>
        </label>
        <TextArea label="Description" value={draft.description || draft.notes || ""} onChange={(next) => onChange({ ...draft, description: next, notes: next })} rows={4} />
        <div className="admin-grid three-up">
          <TextInput label="Tag 1" value={draft.tagWord1 || ""} onChange={(next) => onChange({ ...draft, tagWord1: next })} />
          <TextInput label="Tag 2" value={draft.tagWord2 || ""} onChange={(next) => onChange({ ...draft, tagWord2: next })} />
          <TextInput label="Tag 3" value={draft.tagWord3 || ""} onChange={(next) => onChange({ ...draft, tagWord3: next })} />
        </div>
      </Section>

      <Section
        title="Photos"
        description={`${summary.frames} photo${summary.frames === 1 ? "" : "s"}${summary.cameraModel ? ` · ${summary.cameraModel}` : ""}. Camera details are read from each file automatically.`}
        actions={<button type="button" className="admin-mini-button" onClick={() => onChange({ ...draft, photos: [...photos, createMediaValue()] })}>Add empty slot</button>}
      >
        <MultiUploadZone kind="photography" field="photo" onUpload={onUpload} onAssets={(newAssets) => onChange({ ...draft, photos: mergeIntoSlots(photos, newAssets) })} />
        <div className="admin-stack">
          {photos.map((photo, index) => (
            <ItemCard
              key={`photo-slot-${index}`}
              title={`Photo ${String(index + 1).padStart(2, "0")}`}
              onUp={() => onChange({ ...draft, photos: reorder(photos, index, -1) })}
              onDown={() => onChange({ ...draft, photos: reorder(photos, index, 1) })}
              disableUp={index === 0}
              disableDown={index === photos.length - 1}
              onRemove={() => removePhoto(index)}
            >
              <AssetField label="Image" accept={IMAGE_ACCEPT} value={photo} assets={assets} onUpload={onUpload} onChange={(next) => updatePhoto(index, next)} kind="photography" field={`photo-${index}`} compact />
            </ItemCard>
          ))}
        </div>
      </Section>

      <Section title="Advanced" collapsible defaultOpen={false}>
        <TextInput label="Link name (slug)" hint="Part of the shoot's web address. Set automatically from the title." value={draft.slug} onChange={(next) => onChange({ ...draft, slug: slugify(next) })} />
      </Section>
    </div>
  );
}

export function DraftNotes({ draft, onChange }) {
  return (
    <Section title="Private notes" description="Only you can see these. They are never published." collapsible defaultOpen={Boolean(draft.adminNotes)}>
      <TextArea label="Notes" value={draft.adminNotes || ""} rows={6} onChange={(next) => onChange({ ...draft, adminNotes: next })} />
    </Section>
  );
}
