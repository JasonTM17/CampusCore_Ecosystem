# Thesis topic list sizing

`GET /api/v1/thesis/topics?roundId=<uuid>` returns the topic catalogue of a round. Paging is opt-in through `page` and `limit`, with `X-Total-Count` and `X-Topic-Total-Count` headers. Without paging parameters the endpoint returns the whole authorized list.

## Decision

The operation keeps its contract. Changing the default from "all rows" to "first page" would silently truncate unpaged callers (the admin and workspace views and the advisor directory), and the additive contract gate does not protect default behaviour. The catalogue of one round is naturally bounded, and the catalogue screens on web and mobile already request explicit 20-row pages.

The service reads every visible topic before it filters, sorts and slices, so a very large round costs memory and scan time even for a small page.

## Revisit when

A round passes a few thousand topics. The route to take then is a new bounded operation (default `page=0`, `limit=20`, maximum 100) over SQL windowing with indexed catalogue columns added by a Flyway migration, not a change to this operation.

## Owners

- [Controller](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/web/ThesisTopicController.java)
- [Service](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/service/ThesisTopicService.java)
- [Repository](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/repository/ThesisTopicReadRepository.java)
- [Group governance](thesis-group-governance.md)
