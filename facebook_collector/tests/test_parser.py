import copy
import json
from pathlib import Path
import unittest
from ..collectors.facebook_gql import parse_page, normalize, consolidate
from ..errors import CollectorError


FIXTURE = Path(__file__).with_name('fixtures') / 'group_feed.json'


class ParserTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads(FIXTURE.read_text())

    def test_real_upstream_parser_synthetic_fixture(self):
        page = parse_page(json.dumps(self.document), '123')
        self.assertEqual(page.posts[0]['post_id'], '900')
        self.assertIn('electrician', page.posts[0]['text'])
        self.assertEqual(page.posts[0]['post_url'], 'https://www.facebook.com/groups/123/posts/900')
        self.assertIsNotNone(page.posts[0]['published_at'])
        self.assertNotIn('author', page.posts[0])
        self.assertFalse(page.has_next)

    def test_missing_fields_are_not_fabricated(self):
        node = self.document['data']['node']['group_feed']['edges'][0]['node']
        node.pop('creation_time')
        node['comet_sections'] = {}
        page = parse_page(json.dumps(self.document), '123')
        self.assertIsNone(page.posts[0]['text'])
        self.assertIsNone(page.posts[0]['post_url'])
        self.assertIsNone(page.posts[0]['published_at'])

    def test_invalid_feed_rejected(self):
        for field in ('page_info', 'edges'):
            doc = copy.deepcopy(self.document)
            doc['data']['node']['group_feed'].pop(field)
            with self.assertRaises(CollectorError):
                parse_page(json.dumps(doc), '123')
        with self.assertRaises(CollectorError):
            parse_page(FIXTURE.read_text(), '999')

    def test_invalid_cursor_and_shape(self):
        self.document['data']['node']['group_feed']['page_info'] = {'has_next_page': True}
        with self.assertRaises(CollectorError):
            parse_page(json.dumps(self.document), '123')
        for raw in ('<html>login</html>', '{}', 'not json'):
            with self.assertRaises(CollectorError):
                parse_page(raw, '123')

    def test_opaque_identity_and_external_url_rejected(self):
        for record in ({'id': 'pfbidXYZ'}, {'id': '900','url': 'https://evil.example/a'},
                       {'id': '900','url': 'https://www.facebook.com/groups/123/posts/901'}):
            with self.assertRaises(CollectorError):
                normalize(record, '123')

    def test_deferred_fragment_error_fails_closed(self):
        raw = FIXTURE.read_text().strip() + '\n' + json.dumps({'path':['data','node','id','broken'], 'data': {}})
        with self.assertRaises(CollectorError):
            consolidate(raw)

    def test_valid_deferred_text_fragment_uses_upstream_merger(self):
        node = self.document['data']['node']['group_feed']['edges'][0]['node']
        node['comet_sections']['content']['story']['message'] = {}
        fragment = {'path':['data','node','group_feed','edges',0,'node','comet_sections','content','story','message'],
                    'data':{'text':'A deferred recommendation request'}}
        page = parse_page(json.dumps(self.document)+'\n'+json.dumps(fragment),'123')
        self.assertEqual(page.posts[0]['text'],'A deferred recommendation request')

    def test_relative_graphql_paths_fill_streamed_placeholders_and_page_info(self):
        full = self.document['data']['node']['group_feed']
        base = {'data':{'node':{'__typename':'Group','id':'123','group_feed':{'edges':[None]}}}}
        edge = {'path':['node','group_feed','edges',0],'data':full['edges'][0]}
        info = {'path':['node','group_feed'],'data':{'page_info':full['page_info']}}
        page = parse_page('\n'.join(json.dumps(frame) for frame in (base,edge,info)),'123')
        self.assertEqual(page.posts[0]['post_id'],'900')
        self.assertFalse(page.has_next)

    def test_later_nested_fragment_can_follow_a_streamed_edge(self):
        edge = self.document['data']['node']['group_feed']['edges'][0]
        edge['node']['comet_sections']['content']['story']['message'] = {}
        base = {'data':{'node':{'__typename':'Group','id':'123','group_feed':{'edges':[None],'page_info':{'has_next_page':False}}}}}
        frames = [base,{'path':['node','group_feed','edges',0],'data':edge},
                  {'path':['node','group_feed','edges',0,'node','comet_sections','content','story','message'],'data':{'text':'Deferred actual text'}}]
        page = parse_page('\n'.join(json.dumps(frame) for frame in frames),'123')
        self.assertEqual(page.posts[0]['text'],'Deferred actual text')
