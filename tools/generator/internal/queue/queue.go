// Package queue is the JetStream side of the outbox: the stream the relay
// publishes "job filed" messages to and the durable consumer the worker pulls
// them from. Work-queue retention, so a message lives until a worker acks it;
// explicit acks with a two-minute ack wait, renewed while a job runs, so a
// worker that dies mid-job has its message redelivered.
package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	Stream   = "NOTECOM_JOBS"
	Subject  = "notecom.jobs.filed"
	Consumer = "generator"
	AckWait  = 2 * time.Minute
)

// Message is what one outbox row becomes on the wire.
type Message struct {
	JobID    string `json:"job_id"`
	Kind     string `json:"kind"`
	OutboxID int64  `json:"outbox_id"`
}

// Queue is a connected JetStream with the stream and consumer in place.
type Queue struct {
	NC       *nats.Conn
	JS       jetstream.JetStream
	Consumer jetstream.Consumer
}

// Open connects and makes sure the stream and consumer exist with this
// configuration. maxPending bounds how many messages the server hands out
// unacked at once: the worker's concurrency, with room for one batch more.
func Open(ctx context.Context, url, token string, maxPending int) (*Queue, error) {
	opts := []nats.Option{
		nats.Name("notecom-generator"),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2 * time.Second),
	}
	if token != "" {
		opts = append(opts, nats.Token(token))
	}
	nc, err := nats.Connect(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("nats: %w", err)
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, err
	}
	if _, err := js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:      Stream,
		Subjects:  []string{"notecom.jobs.>"},
		Retention: jetstream.WorkQueuePolicy,
		Storage:   jetstream.FileStorage,
		// A job is given up on six hours after it was filed.
		MaxAge:     7 * time.Hour,
		MaxBytes:   64 << 20,
		Duplicates: 2 * time.Minute,
		Replicas:   1,
	}); err != nil {
		nc.Close()
		return nil, fmt.Errorf("stream: %w", err)
	}
	cons, err := js.CreateOrUpdateConsumer(ctx, Stream, jetstream.ConsumerConfig{
		Durable:       Consumer,
		AckPolicy:     jetstream.AckExplicitPolicy,
		AckWait:       AckWait,
		MaxDeliver:    20,
		MaxAckPending: maxPending,
		FilterSubject: Subject,
	})
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("consumer: %w", err)
	}
	return &Queue{NC: nc, JS: js, Consumer: cons}, nil
}

// Publish sends one outbox message. The row is the JetStream message id, so
// a relay that publishes the same row twice (it crashed before marking it
// published) is deduplicated by the server. The job id is part of it too:
// outbox ids restart in a restored or new database, and a reused id must
// not be mistaken for a duplicate.
func (q *Queue) Publish(ctx context.Context, m Message) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = q.JS.Publish(ctx, Subject, body, jetstream.WithMsgID(fmt.Sprintf("outbox-%d-%s", m.OutboxID, m.JobID)))
	return err
}

func (q *Queue) Close() {
	if q.NC != nil {
		q.NC.Drain()
	}
}
