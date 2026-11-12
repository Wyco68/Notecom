package worker

import "testing"

func TestJoinContinuation(t *testing.T) {
	partial := "<p>The router looks up the destination address in its table and"
	cases := []struct{ more, want string }{
		// Repeats the last words: joined at the overlap.
		{" address in its table and picks the longest match.</p>", partial + " picks the longest match.</p>"},
		// Wrapped in a code fence: the fence goes.
		{"```html\n picks the route.</p>", partial + " picks the route.</p>"},
		// No overlap: appended.
		{" picks a route.</p>", partial + " picks a route.</p>"},
	}
	for _, c := range cases {
		if got := joinContinuation(partial, c.more); got != c.want {
			t.Errorf("join(%q)\n got %q\nwant %q", c.more, got, c.want)
		}
	}
}
