output "invoke_url" {
    description = "Base invoke URL for the API Gateway dev stage"
    value       = aws_api_gateway_stage.api_gateway_stage.invoke_url
  }