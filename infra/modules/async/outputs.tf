output "notification_events_queue_url" {
  description = "URL of the notification-events queue (digest enqueues here, notifications consumes)"
  value       = aws_sqs_queue.notification_events.url
}

output "notification_events_queue_arn" {
  value = aws_sqs_queue.notification_events.arn
}

output "transaction_events_queue_url" {
  description = "URL of the transaction-events queue (transactions Lambda enqueues here on write)"
  value       = aws_sqs_queue.transaction_events.url
}

output "transaction_events_queue_arn" {
  value = aws_sqs_queue.transaction_events.arn
}
