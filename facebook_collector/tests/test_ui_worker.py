from datetime import datetime, timezone
import tempfile
import unittest
from unittest.mock import Mock, patch
from ..accounts.manager import Accounts
from ..collectors.base import Page
from ..errors import CollectorError
from ..storage.database import Database
from ..ui_worker import cycle
from .test_checkpoint import FakeCollector, post


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=Database(self.temp.name)
        self.aid=Accounts(self.db).add('Synthetic worker')['id']
        self.groups=[{'ui_id':'a','name':'A','reference':'123'},{'ui_id':'b','name':'B','reference':'456'}]

    def tearDown(self):
        self.db.close();self.temp.cleanup()

    def test_sequential_access_checks_and_pause_without_saving_samples(self):
        events=[];pause=Mock();calls=[]
        def factory(db,aid,gid):
            calls.append((aid,gid));return FakeCollector([Page([post()],False,None)])
        cycle(self.db,{'mode':'test','pacing':{'shuffleGroups':False,'groupMinSeconds':10,'groupMaxSeconds':10},'account':self.aid,'groups':self.groups},factory,events.append,pause)
        self.assertEqual(calls,[(self.aid,'123'),(self.aid,'456')]);pause.assert_called_once_with(10)
        self.assertEqual([e['status'] for e in events if e['type']=='group_result'],['accessible','accessible'])
        self.assertEqual(self.db.one('SELECT count(*) n FROM posts')['n'],0)

    def test_shuffle_and_group_delay_are_drawn_for_each_cycle_without_mutating_input(self):
        calls=[];pause=Mock()
        def factory(db,aid,gid):
            calls.append(gid);return FakeCollector([Page([post()],False,None)])
        with patch('facebook_collector.ui_worker.random.shuffle',side_effect=lambda rows:rows.reverse()),patch('facebook_collector.ui_worker.random.uniform',return_value=12.5):
            cycle(self.db,{'mode':'test','account':self.aid,'groups':self.groups},factory,lambda event:None,pause)
        self.assertEqual(calls,['456','123'])
        self.assertEqual(self.groups[0]['reference'],'123')
        pause.assert_called_once_with(12.5)

    def test_invalid_pacing_is_rejected_before_a_request(self):
        factory=Mock()
        with self.assertRaises(ValueError):
            cycle(self.db,{'mode':'test','account':self.aid,'groups':self.groups,'pacing':{'requestMinSeconds':9,'requestMaxSeconds':5}},factory,lambda event:None,Mock())
        factory.assert_not_called()

    def test_restriction_stops_cycle_before_next_group(self):
        events=[];factory=Mock(side_effect=CollectorError('restricted','Security check'))
        cycle(self.db,{'mode':'test','pacing':{'shuffleGroups':False,'groupMinSeconds':10,'groupMaxSeconds':10},'account':self.aid,'groups':self.groups},factory,events.append,Mock())
        self.assertEqual(factory.call_count,1);self.assertEqual(events[-1]['reason'],'restricted')

    def test_named_group_is_reported_without_network_and_next_group_is_checked(self):
        events=[];factory=Mock(return_value=FakeCollector([Page([post()],False,None)]))
        groups=[{**self.groups[0],'reference':'https://www.facebook.com/groups/example'},self.groups[1]]
        cycle(self.db,{'mode':'test','pacing':{'shuffleGroups':False,'groupMinSeconds':10,'groupMaxSeconds':10},'account':self.aid,'groups':groups},factory,events.append,Mock())
        self.assertEqual([e['status'] for e in events if e['type']=='group_result'],['numeric_id_required','accessible'])
        self.assertEqual(factory.call_count,1)

    def test_collection_persists_and_deduplicates_without_emitting_text(self):
        events=[]
        factory=lambda *args: FakeCollector([Page([post(published=datetime.now(timezone.utc).isoformat())],False,None)])
        spec={'mode':'run','account':self.aid,'groups':self.groups[:1],'max_pages':1,'limit':5}
        cycle(self.db,spec,factory,events.append,Mock());cycle(self.db,spec,factory,events.append,Mock())
        results=[e['result'] for e in events if e['type']=='group_result']
        self.assertEqual([r['new_posts'] for r in results],[1,0]);self.assertNotIn('new_records',results[0])
        self.assertNotIn('Recommend an electrician',str(events))


    def test_scan_interrupt_cancels_entire_cycle_before_next_group(self):
        events=[];pause=Mock()
        factory=Mock(side_effect=KeyboardInterrupt())
        cycle(self.db,{'mode':'run','pacing':{'shuffleGroups':False},'account':self.aid,'groups':self.groups},factory,events.append,pause)
        self.assertEqual(factory.call_count,1)
        pause.assert_not_called()
        self.assertEqual(events[-1],{'type':'stopped','reason':'cancelled'})
        self.assertEqual(len([e for e in events if e['type']=='group_started']),1)
        self.assertFalse(any(e['type']=='completed' for e in events))
