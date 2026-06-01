output "zone_id" {
  value = aws_route53_zone.ssp.zone_id
}

output "zone_name" {
  value = aws_route53_zone.ssp.name
}

output "delegation_ns_records" {
  description = "Add these as NS records on the parent zone (eaglesoftvn.com at Namecheap) for 'ssp' to delegate the subdomain to Route53."
  value       = aws_route53_zone.ssp.name_servers
}
