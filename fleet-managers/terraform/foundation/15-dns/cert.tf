# ACM certificate(s) for the SSP zone, DNS-validated against the same Route53 zone
# managed here. The wildcard covers every <subdomain>.ssp.mightybee.dev (portal, hr,
# any future tenant-named host). The per-host portal cert is kept around for now —
# easy to drop in MVP2 once everything is on the wildcard.

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

# Wildcard for the entire SSP subdomain.
resource "aws_acm_certificate" "wildcard" {
  domain_name               = "*.${var.ssp_zone_name}"
  subject_alternative_names = [var.ssp_zone_name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "wildcard_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.wildcard_cert_validation : r.fqdn]
}

output "portal_certificate_arn" {
  value = aws_acm_certificate_validation.portal.certificate_arn
}

output "wildcard_certificate_arn" {
  description = "ACM cert ARN for *.ssp.mightybee.dev + ssp.mightybee.dev. Use this as the Gateway HTTPS listener default cert."
  value       = aws_acm_certificate_validation.wildcard.certificate_arn
}
