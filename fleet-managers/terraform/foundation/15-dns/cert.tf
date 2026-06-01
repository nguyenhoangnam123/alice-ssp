# ACM certificate for the portal, DNS-validated against the same Route53 zone managed here.
# Lives in 15-dns because the validation record is a sibling of the zone — both AWS-side,
# nothing K8s about them. The cert ARN feeds the Gateway HTTPS listener (see 40-platform-addons).
resource "aws_acm_certificate" "portal" {
  domain_name       = "portal.${var.ssp_zone_name}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "portal_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.portal.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.ssp.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "portal" {
  certificate_arn         = aws_acm_certificate.portal.arn
  validation_record_fqdns = [for r in aws_route53_record.portal_cert_validation : r.fqdn]
}

output "portal_certificate_arn" {
  value = aws_acm_certificate_validation.portal.certificate_arn
}
