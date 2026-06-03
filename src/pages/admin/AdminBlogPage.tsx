import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Globe,
  EyeOff,
  ExternalLink,
  Newspaper,
  ImageOff,
} from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { BlogPost, BlogStatus } from "@/lib/types"
import { slugify } from "@/lib/blog"
import { Markdown } from "@/components/Markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type FormState = {
  title: string
  slug: string
  excerpt: string
  content: string
  cover_image_url: string
  tags: string
  author_name: string
  status: BlogStatus
  seo_title: string
  seo_description: string
}

const EMPTY_FORM: FormState = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  cover_image_url: "",
  tags: "",
  author_name: "ProfitSync Team",
  status: "draft",
  seo_title: "",
  seo_description: "",
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function AdminBlogPage() {
  const { getToken } = useAuth()
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<BlogPost | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<BlogPost[]>("/api/admin/blog", token)
      setPosts(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load posts")
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const onTitleChange = (title: string) => {
    setForm((f) => ({
      ...f,
      title,
      // Auto-derive the slug from the title until the user edits it themselves
      // (only while creating — never silently rewrite an existing post's slug).
      slug: !slugTouched && !editing ? slugify(title) : f.slug,
    }))
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setSlugTouched(false)
    setEditorOpen(true)
  }

  const openEdit = (post: BlogPost) => {
    setEditing(post)
    setForm({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      cover_image_url: post.cover_image_url,
      tags: (post.tags ?? []).join(", "),
      author_name: post.author_name,
      status: post.status,
      seo_title: post.seo_title,
      seo_description: post.seo_description,
    })
    setSlugTouched(true)
    setEditorOpen(true)
  }

  const slugPreview = slugify(form.slug || form.title) || "post"

  const save = async () => {
    if (!form.title.trim()) {
      toast.error("A title is required")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const payload = {
        title: form.title,
        slug: form.slug,
        excerpt: form.excerpt,
        content: form.content,
        cover_image_url: form.cover_image_url,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        author_name: form.author_name,
        status: form.status,
        seo_title: form.seo_title,
        seo_description: form.seo_description,
      }
      if (editing) {
        await apiPatch<BlogPost>(`/api/admin/blog/${editing.id}`, token, payload)
        toast.success("Post updated")
      } else {
        await apiPost<BlogPost>("/api/admin/blog", token, payload)
        toast.success("Post created")
      }
      setEditorOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save post")
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async (post: BlogPost) => {
    setBusyId(post.id)
    try {
      const token = await getToken()
      if (!token) return
      const next: BlogStatus = post.status === "published" ? "draft" : "published"
      await apiPatch<BlogPost>(`/api/admin/blog/${post.id}`, token, { status: next })
      toast.success(next === "published" ? "Post published" : "Post unpublished")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status")
    } finally {
      setBusyId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/admin/blog/${deleteTarget.id}`, token)
      toast.success("Post deleted")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete post")
    } finally {
      setDeleting(false)
    }
  }

  const publishedCount = useMemo(() => posts.filter((p) => p.status === "published").length, [posts])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Blog</h1>
          <p className="text-sm text-muted-foreground">
            Write and manage posts for the public blog.{" "}
            {!loading && (
              <span>
                {posts.length} {posts.length === 1 ? "post" : "posts"} · {publishedCount} published
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/blog" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              View blog
            </a>
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New post
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Newspaper className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No posts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create your first post to populate the blog.</p>
          <Button className="mt-4" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New post
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <div className="hidden size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted sm:flex">
                  {post.cover_image_url ? (
                    <img src={post.cover_image_url} alt="" className="size-full object-cover" />
                  ) : (
                    <ImageOff className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{post.title}</p>
                    <Badge
                      variant={post.status === "published" ? "default" : "secondary"}
                      className={
                        post.status === "published"
                          ? "bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500"
                          : ""
                      }
                    >
                      {post.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">/blog/{post.slug}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {post.status === "published"
                      ? `Published ${fmtDate(post.published_at)}`
                      : `Updated ${fmtDate(post.updated_at)}`}
                    {typeof post.reading_time_minutes === "number" && ` · ${post.reading_time_minutes} min read`}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {post.status === "published" && (
                  <Button variant="ghost" size="icon" asChild title="View on site">
                    <a href={`/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => togglePublish(post)}
                  disabled={busyId === post.id}
                >
                  {busyId === post.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : post.status === "published" ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Globe className="size-4" />
                  )}
                  {post.status === "published" ? "Unpublish" : "Publish"}
                </Button>
                <Button variant="outline" size="icon" onClick={() => openEdit(post)} title="Edit">
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(post)}
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit post" : "New post"}</DialogTitle>
            <DialogDescription>
              Content is written in Markdown and rendered on the public blog. Posts are only visible once
              published.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="blog-title">Title</Label>
              <Input
                id="blog-title"
                value={form.title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="How to track your cash flow"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="blog-slug">Slug</Label>
              <Input
                id="blog-slug"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  update({ slug: e.target.value })
                }}
                placeholder="how-to-track-your-cash-flow"
              />
              <p className="text-xs text-muted-foreground">
                URL: <span className="font-mono">/blog/{slugPreview}</span>
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="blog-cover">Cover image URL</Label>
                <Input
                  id="blog-cover"
                  value={form.cover_image_url}
                  onChange={(e) => update({ cover_image_url: e.target.value })}
                  placeholder="https://…/cover.jpg"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blog-author">Author</Label>
                <Input
                  id="blog-author"
                  value={form.author_name}
                  onChange={(e) => update({ author_name: e.target.value })}
                  placeholder="ProfitSync Team"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="blog-excerpt">Excerpt</Label>
              <Textarea
                id="blog-excerpt"
                value={form.excerpt}
                onChange={(e) => update({ excerpt: e.target.value })}
                placeholder="A short summary shown on cards and in search results."
                className="min-h-[64px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="blog-tags">Tags</Label>
              <Input
                id="blog-tags"
                value={form.tags}
                onChange={(e) => update({ tags: e.target.value })}
                placeholder="finance, freelancing, tips"
              />
              <p className="text-xs text-muted-foreground">Comma-separated.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Content</Label>
              <Tabs defaultValue="write">
                <TabsList>
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="write">
                  <Textarea
                    value={form.content}
                    onChange={(e) => update({ content: e.target.value })}
                    placeholder={"# Heading\n\nWrite your post in **Markdown**…"}
                    className="min-h-[320px] font-mono text-sm"
                  />
                </TabsContent>
                <TabsContent value="preview">
                  <div className="min-h-[320px] rounded-md border border-border p-5">
                    {form.content.trim() ? (
                      <Markdown content={form.content} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">SEO (optional)</p>
              <p className="mb-3 text-xs text-muted-foreground">Falls back to the title and excerpt when blank.</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="blog-seo-title">SEO title</Label>
                  <Input
                    id="blog-seo-title"
                    value={form.seo_title}
                    onChange={(e) => update({ seo_title: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="blog-seo-desc">SEO description</Label>
                  <Textarea
                    id="blog-seo-desc"
                    value={form.seo_description}
                    onChange={(e) => update({ seo_description: e.target.value })}
                    className="min-h-[56px]"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => update({ status: v as BlogStatus })}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft — hidden from the public</SelectItem>
                  <SelectItem value="published">Published — live on the blog</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !form.title.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Create post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
