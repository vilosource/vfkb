// vfkb#384: execFileSync buffers a child's stdout up to `maxBuffer`, 1 MiB by default,
// and THROWS (ENOBUFS) past it. Every read of the committed brain (`git show
// HEAD:.vfkb/entries.jsonl`, `git cat-file -p HEAD:…`) went through that default, so
// once a brain passed 1 MiB the read failed, the caller's catch read it as "nothing at
// HEAD", and every entry counted as new (this repo's brain crossed 1 MiB at e7dfc70).
// One shared ceiling for every git call that can return the brain's contents.
export const GIT_READ_MAX_BUFFER = 512 * 1024 * 1024;
